#!/usr/bin/env python3
"""Fetch the public LB score for a single Kaggle kernel through the Kaggle SDK."""

from __future__ import annotations

import argparse


def fetch_kernel_score(kernel_ref: str) -> tuple[str, float | None]:
    """Fetch the public LB score from Kaggle SDK search.

    Args:
        kernel_ref: owner/slug or full Kaggle URL.

    Returns ``(normalized_ref, score)`` where score is ``None`` if not found.
    """
    from kernels.kaggle_search import KaggleKernelSearchClient, parse_kernel_ref

    ref = parse_kernel_ref(kernel_ref)
    result = KaggleKernelSearchClient().get_kernel_score(ref)
    return ref, result.score if result else None


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch a Kaggle kernel's public LB score")
    parser.add_argument("kernel_ref", help="Kernel reference, e.g. owner/kernel-slug, or Kaggle code URL")
    args = parser.parse_args()

    ref, score = fetch_kernel_score(args.kernel_ref)
    print(f"{ref}: {score}")


if __name__ == "__main__":
    main()
