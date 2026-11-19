# Implementation plan

The current handler parses the request and model output in one flow. Both parsing failures reach the same HTTP 500 handler, and the page displays raw JSON. Split those failure paths so a malformed customer request gets HTTP 400 with `invalid_input`, while a valid request that the model cannot process gets HTTP 200 with `manual_review`. [Requirements](../README.md#what-to-change)

## 1. Validate the request before calling the model

- In `handleTriage`, read the body and parse it as JSON. Catch malformed JSON here and return HTTP 400 with exactly `{"status":"invalid_input"}`.
- Require a non-null JSON object with a string `text` field. Use `text.trim().length > 0` to reject empty and whitespace-only requests. Pass the original string to `classify` to preserve the manager’s wording.
- Return immediately on invalid input. Keep the outer HTTP 500 handler for unexpected server failures. [Server](../server.mjs)

## 2. Enforce the model deadline and validate its output

- Call `classify(text, { signal: AbortSignal.timeout(300) })`. The simulator passes the signal to its cancellable delay, so the timeout case can stop at the deadline without changing the simulator.
- Parse the returned JSON. Require an object whose `topic` is exactly `delivery`, `pricing`, or `other`, and whose `draft` is a string containing at least one non-whitespace character. The simulator’s `[empty-draft]` marker returns two spaces.
- On success, return HTTP 200 and construct the response explicitly from `status: "ready"`, `topic`, and `draft`. On timeout, provider error, malformed model JSON, or invalid fields, return HTTP 200 with exactly `{"status":"manual_review","topic":null,"draft":null}`. [Server](../server.mjs) · [Simulator](../mock-ai.mjs)

## 3. Render the result for the manager

- On submit, clear the previous result and disable the submit button while the request is pending. Restore the button in `finally` so the manager can retry.
- Branch on the response body’s `status`. Both `ready` and `manual_review` use HTTP 200.
- For `ready`, display a Russian topic label and the draft in the existing live region using `textContent`. For `manual_review`, replace the entire result with «Проверьте заявку вручную. Черновик ответа недоступен.» This clears the previous topic and draft.
- For `invalid_input`, show «Введите текст заявки.» If the request fails to reach the server, show a retry message and preserve the textarea contents. [Page](../index.html)

## 4. Test the HTTP contract and the stale-draft case

Use Node’s built-in test runner and the real simulator. Expose a server factory, start it on an ephemeral loopback port during tests, and close it afterward. Preserve `node server.mjs` as the normal startup command.

| Case | Input | Expected result |
|---|---|---|
| Invalid request | Malformed JSON, `null`, `{}`, or `text` set to a number, `""`, or `"  "` | HTTP 400 and the exact `invalid_input` body |
| Ready | `Когда доставка?`, `Какая цена?`, and `Здравствуйте` | HTTP 200 with `ready`, respectively `delivery`, `pricing`, and `other`, and a nonblank draft |
| Provider or output failure | `[error]`, `[bad-json]`, `[bad-topic]`, and `[empty-draft]` | HTTP 200 and the exact `manual_review` body for every marker |
| Timeout | `[timeout]` | Same fallback before the simulator’s full 1,200 ms delay |

Allow scheduling tolerance above 300 ms in the timeout test while keeping the assertion below 1,200 ms. In the browser, submit a successful request, then `[bad-topic]`, then another successful request. Verify that the first draft disappears, the manual-review message appears, and the form can display a fresh draft afterward.

## 5. Document how to verify the change

Add `node --test` to the README and explain that the suite starts its own server. Include the three-submission browser check alongside the existing simulator markers. [README](../README.md)

## 6. Required API tests

Send each case through HTTP to `POST /api/triage`. Assert the HTTP status, the `application/json` media type, and deep equality of the complete parsed response. Run each input in a parameterized group as a separate named case. Use the real simulator for its documented behavior. For responses it cannot produce, let the server factory accept a test classifier that defaults to the real one.

- [ ] **Malformed request body.** Send an empty body, whitespace alone, and truncated JSON such as `{"text":`. Each must return HTTP 400 with exactly `{"status":"invalid_input"}`. Send raw bytes for these cases so the test client does not turn them into valid JSON strings.
- [ ] **Invalid request shape.** Send valid JSON with top-level values `null`, `[]`, `"hello"`, `42`, and `true`. Also send `{}`, then objects whose `text` is null, a number, a boolean, an array, or an object. Expect the same 400 response for each.
- [ ] **Blank customer text.** Try an empty string, spaces, and a mixture of tabs and newlines. Expect the same 400 response. Across all invalid-input cases, assert that the test classifier received zero calls.
- [ ] **All supported topics.** Submit `Когда доставка?`, `Какая стоимость?`, and `Здравствуйте`. Expect HTTP 200 with exactly `status`, `topic`, and `draft`. Assert `ready`, the respective topic (`delivery`, `pricing`, or `other`), and the simulator’s full draft, «Спасибо за обращение. Уточним детали заявки.»
- [ ] **Valid text with surrounding whitespace.** Submit `{"text":"  привет  ","id":7}` to a recording classifier. Assert that it receives the original text including both pairs of spaces, then verify the ready response.
- [ ] **Simulator failures.** Submit each marker separately — `[error]`, `[bad-json]`, `[bad-topic]`, and `[empty-draft]`. Every case must return HTTP 200 with exactly `{"status":"manual_review","topic":null,"draft":null}`.
- [ ] **Model output shape and fields.** Have the classifier return JSON encoding null, an array, a string, or an empty object. Starting from a valid result, independently omit each required field, set `topic` to null or `"Delivery"`, and set `draft` to null, a number, an object, an empty string, or whitespace alone. Expect the exact manual-review response for every variant.
- [ ] **Ready response field selection.** Return a valid topic and draft alongside a conflicting `status` and an extra provider field. Expect exactly `{"status":"ready","topic":"other","draft":"Ответ"}` when the supplied topic is `other` and the draft is `Ответ`.
- [ ] **Model deadline.** Submit `[timeout]` to the real simulator. Expect the exact manual-review response within 300 ms plus an explicit scheduling tolerance (e.g., 200 ms on loopback). Measure elapsed time after the server is listening. A handler that waits for the full 1,200 ms simulator delay must fail this test.
- [ ] **Isolation and recovery.** Start a timeout request and a pricing request concurrently. Assert the exact manual-review result for the first and the pricing draft for the second. After both settle, submit a delivery request to the same server and verify its ready response.
