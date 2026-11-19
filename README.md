#  AI assistant for incoming customer requests

A manager enters the text of a customer request. The assistant identifies the topic and drafts a reply. The manager reviews the result and decides what to send to the customer.

## Getting started

The repository includes a server, an HTML page, and a model simulator.  No dependencies or API keys are required.

```sh
node server.mjs
```

Open http://127.0.0.1:3000. You can set the port using the `PORT` environment variable.

## What to change

1. Update `POST /api/triage` to accept a JSON object whose `text` field contains a nonempty string. If `text` is missing, empty, or of the wrong type, or if the JSON is malformed, return HTTP 400 with `{"status":"invalid_input"}`.
2. If the model returns a valid response, return HTTP 200 with `{"status":"ready","topic":"…","draft":"…"}`. Valid topics are `delivery`, `pricing`, and `other`. The draft must be a nonempty string. If the model times out, throws an error, or returns an invalid response, return HTTP 200 with `{"status":"manual_review","topic":null,"draft":null}`. Wait at most 300 ms for the model and preserve the behavior of the provided simulator.
3. On success, display the topic and draft on the page. For `manual_review`, show the manager a clear message and clear any previous draft. Add at least one runnable test that covers a failure case and include instructions for running it.

For local testing, the simulator accepts any plain text. Use one of the following markers to trigger the corresponding failure scenario: `[timeout]`, `[error]`, `[bad-json]`, `[bad-topic]`, or `[empty-draft]`.

## Verification

Run `node --test` to check the API contract. The suite starts its own servers on ephemeral loopback ports and closes them afterward.

With `node server.mjs` running, open the page and submit these requests in order:

1. Submit `Когда доставка?` and verify that «Доставка» and a draft appear.
2. Submit `[bad-topic]` and verify that the topic and draft disappear and the page displays «Проверьте заявку вручную. Черновик ответа недоступен.»
3. Submit `Какая стоимость?` and verify that «Стоимость» and a draft appear.
