---
"@inlang/paraglide-js": minor
---

Add `t` dynamic message lookup exported from `paraglide/messages` alongside `m`, and automatically extract `t("...")` messages into the catalogs on dev server start, rebuilds, and builds (including `paraglide-js compile`).

```ts
import { m, t } from "./paraglide/messages.js";

m.welcome(); // direct, tree-shakeable message call
t("welcome"); // dynamic lookup by message id
t("Hello {name}!", { name: "Ada" }); // inline source text as key
```

Missing keys fall back to formatting the key itself, so freshly written `t("...")` strings render before the next extraction + compilation picks them up.
