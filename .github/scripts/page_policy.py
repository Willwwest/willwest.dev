"""Refresh the CSP hashes after reviewing edits to the site's inline CSS or JS."""
import base64
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHARSET = '<meta charset="utf-8">'
POLICY_META = '<meta http-equiv="Content-Security-Policy" content="'
REFERRER = '<meta name="referrer" content="no-referrer">'


def hashes(markup, tag):
    blocks = re.findall(rf'<{tag}>(.*?)</{tag}>', markup, re.DOTALL)
    return ["'sha256-" + base64.b64encode(hashlib.sha256(block.encode()).digest()).decode() + "'"
            for block in blocks]


def policy_tags(markup):
    # 'self' only on pages that load a script file (the three.js scenes in /assets/fx), so a
    # page with no script of its own keeps script-src 'none'. Inline blocks stay hash-pinned.
    external = ["'self'"] if re.search(r'<script\b[^>]*\bsrc=', markup) else []
    scripts = ' '.join([*external, *hashes(markup, 'script')]) or "'none'"
    styles = ' '.join(["'self'", *hashes(markup, 'style')])
    policy = (f"default-src 'none'; script-src {scripts}; style-src {styles}; "
              "img-src 'self' data:; base-uri 'none'; form-action 'none'")
    return f'{CHARSET}\n{POLICY_META}{policy}">\n{REFERRER}'


if __name__ == '__main__':
    for page in [*ROOT.rglob('index.html'), ROOT / '404.html']:
        markup = page.read_text()
        markup = re.sub(r'\n' + re.escape(POLICY_META) + r'[^"]*">', '', markup)
        markup = markup.replace('\n' + REFERRER, '')
        if markup.count(CHARSET) != 1:
            raise ValueError(f'Expected one charset declaration in {page}')
        page.write_text(markup.replace(CHARSET, policy_tags(markup), 1))
