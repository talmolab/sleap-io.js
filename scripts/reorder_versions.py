#!/usr/bin/env python
"""Reorder versions.json for proper version dropdown sorting in mike docs."""

import json
import re
import sys


def reorder_versions(filepath="versions.json"):
    """Reorder versions.json to fix version dropdown ordering.

    Orders versions as: dev -> newest -> oldest
    """
    with open(filepath, "r") as f:
        versions = json.load(f)

    dev_versions = [v for v in versions if v["version"] == "dev"]
    regular_versions = [v for v in versions if v["version"] != "dev"]

    def get_version_key(v):
        title = v["title"]
        if title.startswith("v"):
            title = title[1:]
        match = re.match(r"(\d+)\.(\d+)\.(\d+)", title)
        if match:
            return tuple(int(x) for x in match.groups())
        return (0, 0, 0)

    regular_versions.sort(key=get_version_key, reverse=True)
    sorted_versions = dev_versions + regular_versions

    with open(filepath, "w") as f:
        json.dump(sorted_versions, f, indent=2)

    print(f"Reordered {len(sorted_versions)} versions in {filepath}")
    if sorted_versions:
        titles = [v["title"] for v in sorted_versions[:5]]
        suffix = "..." if len(sorted_versions) > 5 else ""
        print(f"Order: {' -> '.join(titles)}{suffix}")


if __name__ == "__main__":
    filepath = sys.argv[1] if len(sys.argv) > 1 else "versions.json"
    reorder_versions(filepath)
