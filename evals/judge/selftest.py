#!/usr/bin/env python3
"""Negative controls for system1.py: the detectors must fire on planted bad input."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import system1 as s

planted = {
    "pem private key": "-----BEGIN PRIVATE KEY-----",
    "solana keypair json array": "[" + ",".join(["12"] * 64) + "]",
    "base58 secret key (87-88 chars)": "x = " + "5" * 88,
    "aws access key": "AKIA" + "A" * 16,
    "api key prefix": "sk-" + "a" * 30,
    "assigned secret": "ADMIN_TOKEN=" + "a1b2c3d4e5f6a7b8c9",
    "hex private key (64)": "private_key 0x" + "ab" * 32,
}
fails = []
for label, text in planted.items():
    if not re.search(s.SECRET_PATTERNS[label], text):
        fails.append(f"secret pattern did not fire: {label}")
for ok in ["BUYER_EVM_PRIVATE_KEY=\nNEXT=1", "BUYER_SOLANA_KEYPAIR=/ABSOLUTE/PATH/buyer.keypair.json", "ADMIN_TOKEN=<your token>"]:
    if re.search(s.SECRET_PATTERNS["assigned secret"], ok):
        fails.append(f"secret pattern false positive: {ok!r}")
if not (re.search("Supabase", "We use Supabase for auth", re.I) and not s.NEGATION.search("We use Supabase for auth")):
    fails.append("forbidden-claim positive case not flagged")
if not s.NEGATION.search("We do not claim Web Bot Auth verification"):
    fails.append("negation not recognised")
if not (s.PAY_LINE.search("the demo paid $0.002") and s.DEMO_LINE.search("the demo paid $0.002")):
    fails.append("demo payment line not recognised")
print("selftest FAIL" if fails else "selftest OK", *fails, sep="\n")
sys.exit(1 if fails else 0)
