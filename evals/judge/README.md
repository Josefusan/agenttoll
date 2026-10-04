# evals/judge

LLM-as-judge and System-1 checks for the Colosseum submission.

- rubric.md: seven weighted criteria with anchors for 3, 6, 8 and 10.
- judge.py: builds a packet from the repo, asks N headless Claude judges (default 3, model sonnet), writes results/latest.json and latest.md. Run: python3 evals/judge/judge.py --judges 3. The packet leaves out results/system1.json by default so the judges read the docs independently (`--no-exclude-system1` puts it back); latest.md records that choice, the resolved model id from the claude CLI envelope, and the limitation that all judges share one model and differ only by lens prompt.
- system1.py: six fast checks with deterministic rules. If a Jev key exists (TYPESAFE_API_KEY or mode-600 ~/.jev/.env) and typesafe_sdk imports (use ~/jev-ops/.venv/bin/python), each check is also put to Jev as a yes/no question. Without a key every check says engine=rules (Jev key missing). Jev never overrides a failing rule. Run: python3 evals/judge/system1.py, add --capture-tests to rerun the three test suites and store their output in results/test-output/.
- selftest.py: negative controls. Planted secrets must be caught anywhere under evals/judge/ (only lines marked `secret-scan: pattern-definition` in selftest.py and system1.py are exempt), a forbidden claim next to "only" or "if" must be caught while a nearby real negation clears it, and judge.py must leave system1.json out and read the model id. Run: python3 evals/judge/selftest.py

Results are model opinions and heuristics, not proof. The simulated_labels and forbidden_claims checks are line-based heuristics and can miss or over-flag.
