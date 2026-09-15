# A2UI v0.9.1 conformance corpus

S3.1 pins the current production A2UI specification at upstream commit
`981e82f1a3cef88456416fa6fd80d8490964df01`.

- Source: <https://github.com/a2ui-project/a2ui/tree/981e82f1a3cef88456416fa6fd80d8490964df01/specification/v0_9_1>
- Protocol schema: `specification/v0_9_1/json/server_to_client.json`
- Capability schema: `specification/v0_9_1/json/client_capabilities.json`
- License: Apache License 2.0, retained from the upstream repository.

`upstream/00_simple-text.json` is an unchanged upstream legal Basic Catalog example. The
runtime deliberately does not advertise the full upstream Basic Catalog: it advertises only
`urn:a2ui-terminal:catalog:basic:v1`. Its 13 base components predate S3.1 and S3.2 adds
six fixed, local components, for 19 total; this still is not the upstream Basic Catalog.
Therefore the unchanged upstream example must be recognized as valid A2UI syntax but safely
rejected at Catalog negotiation rather than rendered.

`runtime-cases.json` contains the local renderer profile cases derived from the official
v0.9.1 envelope and capability rules. It covers an accepted v0.9.1 initial batch and
incremental batch, an accepted compatible v0.9 batch, the accepted S3.2 expanded Catalog,
incompatible protocol version,
unsupported Catalog, unknown component, and unknown Action. Inline catalogs, executable
content, remote resources, and model-driven `deleteSurface` remain unsupported.
