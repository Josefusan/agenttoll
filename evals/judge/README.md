# evals/judge

LLM-as-judge and System-1 checks for the Colosseum submission.

- rubric.md: seven weighted criteria with anchors for 3, 6, 8 and 10.
- judge.py: builds a packet from the repo, asks N headless Claude judges (default 3, model sonnet), writes results/latest.json and latest.md. Run: python3 evals/judge/judge.py --judges 3
- system1.py: six fast checks with deterministic rules. If a Jev key exists (TYPESAFE_API_KEY or mode-600 ~/.jev/.env) and typesafe_sdk imports (use ~/jev-ops/.venv/bin/python), each check is also put to Jev as a yes/no question. Without a key every check says engine=rules (Jev key missing). Jev never overrides a failing rule. Run: python3 evals/judge/system1.py, add --capture-tests to rerun the three test suites and store their output in results/test-output/.
- selftest.py: negative controls, planted secrets must be caught.

Results are model opinions and heuristics, not proof. The simulated_labels and forbidden_claims checks are line-based heuristics and can miss or over-flag.
