import shutil
from pathlib import Path


def on_page_content(html: str, page, config, files) -> str:  # noqa: ARG001
    src_path = Path(page.file.src_path)
    if src_path.name == "index.md":
        md_url = "index.md"
    else:
        md_url = f"../{src_path.name}"

    svg_icon = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 '
        '2-2V8l-6-6m4 18H6V4h7v5h5v11M13 9V3.5L18.5 9H13Z"/></svg>'
    )
    source_link = (
        f'<div class="md-source-file">'
        f'<a href="{md_url}" title="View markdown source" class="md-icon">'
        f"{svg_icon}</a></div>\n"
    )

    return source_link + html


def on_post_build(config, **kwargs):  # noqa: ARG001
    docs_dir = Path(config["docs_dir"])
    site_dir = Path(config["site_dir"])
    for md_file in docs_dir.rglob("*.md"):
        rel_path = md_file.relative_to(docs_dir)
        dest_path = site_dir / rel_path
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(md_file, dest_path)

    print("Copied markdown source files to output directory")
