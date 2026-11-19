# willwest.dev

Portfolio site for Will West, served at https://willwest.dev via GitHub Pages.

## Search checks

Run `python3 .github/scripts/check_search.py` before publishing. Once GitHub Pages has deployed the change, run `python3 .github/scripts/check_search.py --live` to check the production HTTPS responses. Both commands compare the sitemap with the site's HTML pages and check canonicals, crawler rules, metadata, and internal links. A failed check exits with a nonzero status.

After reviewing changes to inline scripts or styles, run `python3 .github/scripts/page_policy.py` to refresh the Content Security Policy hashes, then run the search check.

## Three.js scenes

The hero constellation, the two "How I work" figures and the 404 point cloud are built from `tools/fx/src` into `assets/fx`. Pages reference only `assets/fx/boot.*.js`, a small loader that pulls in three.js and the scene modules on demand, and skips them entirely without WebGL2 or with Save-Data on. Reduced-motion visitors get still frames in the hero and on the 404 page, and no "How I work" figures.

To change a scene, edit `tools/fx/src`, then run `cd tools/fx && npm install && npm run build`. The build rewrites the boot filename in `index.html` and `404.html`. After that, run `python3 .github/scripts/page_policy.py` and the search check. Pages that load a script file get `script-src 'self'` in their CSP. Pages without one keep `'none'`.
