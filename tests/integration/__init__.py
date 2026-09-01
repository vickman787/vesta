"""Integration tests: real deployment, real RPC, real consensus pipeline.

Unlike the direct-mode suite, these deploy the contract to a running GenLayer
network and drive it over JSON-RPC. That exercises everything direct mode fakes:
calldata encoding, the consensus pipeline, storage round-trips, and the value
transfer path.

Run against a local simulator (no Docker required):

    .venv\\Scripts\\glsim.exe --port 4000 --validators 3 --no-browser
    gltest tests/integration -v -s --network localnet

By default the validators' LLM is mocked so the suite is deterministic and free.
Set GUARDIAN_LIVE_LLM=1 to let the network call a real model instead, which is
the only way to observe genuine validator agreement — see `test_live_llm.py`.
"""
