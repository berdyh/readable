This module owns the chat wire contract. `web.chat.model` **derives** its
client types from `./types` rather than redeclaring them, and closes with
`Assert<IsAssignable<…>>` checks for the parts extension cannot express.

When a wire shape changes, those assertions are the thing that tells you which client
assumption broke. Fix the client — do not relax the assertion.
