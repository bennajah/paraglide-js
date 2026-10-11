---
"@inlang/paraglide-js": patch
---

Cache Intl formatters used by compiled messages instead of constructing them on every call. Bound each formatter cache to 256 locale/options configurations, preserve direct-call option semantics, and include caching in middleware-injected messages.

Date/time formatters are cached only with an explicit time zone, so messages using the host default follow device or process time zone changes.
