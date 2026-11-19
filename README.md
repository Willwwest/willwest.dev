# willwest.dev

Portfolio site for Will West, served at https://willwest.dev via GitHub Pages.

## Search checks

Run `python3 .github/scripts/check_search.py` before publishing. Once GitHub Pages has deployed the change, run `python3 .github/scripts/check_search.py --live` to check the production HTTPS responses. Both commands compare the sitemap with the site's HTML pages and check canonicals, crawler rules, metadata, and internal links. A failed check exits with a nonzero status.

After reviewing changes to inline scripts or styles, run `python3 .github/scripts/page_policy.py` to refresh the Content Security Policy hashes, then run the search check.
