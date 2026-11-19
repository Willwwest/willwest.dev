"""Check the local search pages, or the deployed site with --live."""
import argparse
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from mimetypes import guess_type
from pathlib import Path
from urllib.parse import unquote, urldefrag, urljoin, urlsplit
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree

from page_policy import policy_tags

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = 'https://willwest.dev'


def srcset_urls(value):
    # URLs can contain commas (notably inline data images). Descriptors end at the next comma.
    while value.strip(' ,\t\r\n\f'):
        url, *rest = value.lstrip(' ,\t\r\n\f').split(None, 1)
        yield url.rstrip(',')
        value = rest[0] if rest else ''
        if not url.endswith(','):
            value = value.partition(',')[2]


class Page(HTMLParser):
    def __init__(self, markup):
        super().__init__()
        self.canonicals = []
        self.description = ''
        self.robots = []
        self.links = []
        self.assets = []
        self.headings = 0
        self.title = ''
        self.in_title = False
        self.feed(markup)
        self.close()

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'title':
            self.in_title = True
        if tag == 'h1':
            self.headings += 1
        if tag == 'link' and 'canonical' in attrs.get('rel', '').lower().split():
            self.canonicals.append(attrs.get('href'))
        if tag == 'meta':
            name = attrs.get('name', '').lower()
            if name == 'description':
                self.description = attrs.get('content', '').strip()
            if name in ('robots', 'googlebot'):
                self.robots.append(attrs.get('content', ''))
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])

        if tag == 'img' and attrs.get('src'):
            self.assets.append((attrs['src'], 'image'))
        if tag in ('img', 'source') and attrs.get('srcset'):
            self.assets.extend((src, 'image') for src in srcset_urls(attrs['srcset']))
        if tag == 'link' and 'stylesheet' in attrs.get('rel', '').lower().split() and attrs.get('href'):
            self.assets.append((attrs['href'], 'stylesheet'))
        if tag == 'a' and attrs.get('href'):
            mime = guess_type(urlsplit(attrs['href']).path)[0] or ''
            if mime.startswith('image/'):
                self.assets.append((attrs['href'], 'image'))

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data


def read(path, live):
    if live:
        url = ORIGIN + path
        with urlopen(Request(url, headers={'User-Agent': 'WillWest-Site-Check/1.0'}), timeout=15) as response:
            if response.status != 200 or response.url != url:
                raise ValueError(f'{url} returned {response.status} at {response.url}')
            directives = response.headers.get_all('X-Robots-Tag', [])
            return response.read().decode(), directives
    file = ROOT / path.lstrip('/')
    if file.is_dir():
        file = file / 'index.html'
    return file.read_text(), []


def check_asset(url, kind, live):
    path = (ROOT / unquote(urlsplit(url).path).lstrip('/')).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file() or not path.stat().st_size:
        raise ValueError('missing or empty in the deployment source')
    if live:
        request = Request(url, headers={'User-Agent': 'WillWest-Site-Check/1.0'})
        with urlopen(request, timeout=15) as response:
            mime = response.headers.get_content_type()
            if response.status != 200 or response.url != url:
                raise ValueError(f'HTTP {response.status} at {response.url}')
            if not (mime.startswith('image/') if kind == 'image' else mime == 'text/css'):
                raise ValueError(f'unexpected content type {mime}')
            if response.read() != path.read_bytes():
                raise ValueError('served bytes differ from the deployment source')


def check_privacy(path, markup, page, errors):
    source, _ = read(path, False)
    if policy_tags(source) not in markup or policy_tags(markup) != policy_tags(source):
        errors.append(f'{path} content security policy differs from the reviewed source')
    if re.search(r'@(?:gmail|googlemail)\.com\b', markup, re.IGNORECASE):
        errors.append(f'{path} contains a personal email domain')
    for link in page.links:
        target = urlsplit(link)
        if target.scheme == 'tel' or (target.scheme == 'mailto' and target.path != 'quotes@willwest.dev'):
            errors.append(f'{path} publishes an unexpected contact link')


def check(live):
    paths = set()
    for file in ROOT.rglob('index.html'):
        relative = file.relative_to(ROOT)
        if not any(part.startswith('.') for part in relative.parts):
            paths.add('/' + relative.as_posix().removesuffix('index.html'))
    sitemap, _ = read('/sitemap.xml', live)
    root = ElementTree.fromstring(sitemap)
    namespace = '{http://www.sitemaps.org/schemas/sitemap/0.9}'
    urls = [node.text for node in root.findall(f'{namespace}url/{namespace}loc')]
    expected = {ORIGIN + path for path in paths}
    errors = []
    if Counter(urls) != Counter(expected):
        errors.append(f'Sitemap differs from the published pages. Expected {sorted(expected)}, got {urls}')

    robots, _ = read('/robots.txt', live)
    rules = RobotFileParser()
    rules.parse(robots.splitlines())
    if ORIGIN + '/sitemap.xml' not in (rules.site_maps() or []):
        errors.append('robots.txt must advertise the canonical sitemap')

    missing_page, _ = read('/404.html', live)
    check_privacy('/404.html', missing_page, Page(missing_page), errors)

    assets = {}
    links = {}
    titles = Counter()
    for path in sorted(paths):
        url = ORIGIN + path
        markup, headers = read(path, live)
        page = Page(markup)
        check_privacy(path, markup, page, errors)
        if page.canonicals != [url]:
            errors.append(f'{path} canonical: {page.canonicals}')
        if page.headings != 1 or not page.title.strip() or not page.description:
            errors.append(f'{path} needs one H1, a title and a description')
        directives = ','.join(page.robots + headers).lower()
        if any(token in directives for token in ('noindex', 'nosnippet', 'none', 'max-snippet:0')):
            errors.append(f'{path} restricts indexing or snippets: {directives}')
        for crawler in ('Googlebot', 'OAI-SearchBot', 'Bingbot'):
            if not rules.can_fetch(crawler, url):
                errors.append(f'{path} blocked for {crawler} by robots.txt')
        for reference, kind in page.assets:
            target, _ = urldefrag(urljoin(url, reference))
            if target.startswith(ORIGIN + '/'):
                assets.setdefault((target, kind), path)
        titles[page.title.strip()] += 1
        links[path] = set()
        for link in page.links:
            target = urlsplit(urljoin(url, link))
            if target.netloc != urlsplit(ORIGIN).netloc:
                continue
            if target.path in paths:
                links[path].add(target.path)
            elif not (ROOT / target.path.lstrip('/')).is_file():
                errors.append(f'{path} broken internal link: {link}')

    with ThreadPoolExecutor(max_workers=6) as pool:
        checks = {key: pool.submit(check_asset, *key, live) for key in assets}
        for (url, kind), result in checks.items():
            try:
                result.result()
            except (OSError, ValueError) as error:
                errors.append(f'{assets[url, kind]} {kind} {url}: {error}')

    seen = set()
    queue = ['/']
    while queue:
        path = queue.pop()
        if path not in seen:
            seen.add(path)
            queue.extend(links[path] - seen)
    for path in sorted(paths - seen):
        errors.append(f'{path} unreachable via links from home')
    for title, count in titles.items():
        if count > 1:
            errors.append(f'Repeated page title: {title}')
    if errors:
        raise ValueError('\n'.join(errors))
    counts = Counter(kind for _, kind in assets)
    print(f'Passed: {len(paths)} pages, {counts["image"]} images, {counts["stylesheet"]} stylesheets, robots.txt and sitemap.xml.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='fetch the canonical HTTPS URLs')
    try:
        check(parser.parse_args().live)
    except (OSError, ValueError, ElementTree.ParseError) as error:
        raise SystemExit(f'Search check failed: {error}')
