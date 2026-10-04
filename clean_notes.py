#!/usr/bin/env python3
"""Strip research commentary (data sources, fetch logs, review passes, gaps) from the
notes and senior_programs text of biller entries, keeping the practical facts.

usage: clean_notes.py            # rewrite categories/*.json in place
       clean_notes.py --sample N # print N before/after pairs, change nothing
       clean_notes.py --residual # list kept sentences that still look like commentary

Text with a rewrite in rosters/_raw/clean/out/*.json (keyed by sha1(field\\0text)[:16]) uses
that rewrite instead of the rules.
"""
import glob, hashlib, json, os, random, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))

# A sentence matching any of these is about the research, not the biller.
DROP = re.compile("|".join([
    r"\broster\b", r"\bdataset\b", r"\bdata ?set\b", r"\bbackfill", r"\breviewer?\b",
    r"\bre-?checked\b", r"\bupgraded?\b", r"\bdetail(ed)? upgrade", r"\blink audit",
    r"\bfetch(ed|ing)?\b", r"\bpage title\b", r"\bauto-?(extracted|matched|detected)",
    r"\bautomated (check|fetch|read|crawl|search|match)", r"\b(located|found|matched|checked) automatically\b", r"\bcrawl", r"\bdomain probe", r"keyword-checked",
    r"\burl check", r"\bhttp \d{3}\b", r"\b(403|404)\b", r"\bresponded when\b", r"\bnot reachable\b",
    r"\bnot (yet )?researched\b", r"\bnot (in|listed in) (the )?\w* ?(dataset|roster|data)\b",
    r"\bwebsite not (identified|found|in)\b", r"\bnot located\b", r"\bno website in\b",
    r"\bno working website\b", r"\bnot described on public pages\b", r"\bthis session\b",
    r"\bsdwis\b", r"\bpwsids?\b", r"\bhifld\b", r"\bncua\b", r"\bcall report\b", r"\bfdic\b",
    r"\bbankfind\b", r"\beia[- ]?(\d{3}|176|utility|id|roster|form)", r"\beia\b",
    r"\bfcc form\b", r"\bform 4\d\d\b", r"\busac\b(?! lifeline)", r"\bwikidata\b", r"\bahrq\b",
    r"\bnppes\b", r"\bcensus blocks?\b", r"\bilsr\b", r"\bntca smart\b", r"\baca connects member\b",
    r"\bcms (dy|directory|ownership|chain|doctors|dialysis|'medicare|data)", r"\bcfpb (consumer )?complaint",
    r"\bcomplaint counts\b", r"\bpopulation served\b", r"\bservice connections\b",
    r"\bself-reported\b", r"\bwebsite (derived|source|added|replaced|is as|from)\b",
    r"\bsite (derived|source)\b", r"\b(checked|verified|confirmed) (on )?20\d\d-\d\d-\d\d",
    r"\b20\d\d-\d\d-\d\d\b", r"\bpointer row\b", r"\bdo not duplicate\b", r"\.json\b",
    r"\bsee (the )?\w[\w -]* (category|entry|row)\b", r"\bcategory\b", r"\bsource:", r"\bsources?\b.*\b(list|directory)\b",
    r"\bfrom (the )?(cms|epa|hud|hifld|eia|fcc|ncua|fdic|cfpb|usac|ahrq|nppes|wikidata|texas comptroller|"
    r"ohio department|connecticut .*list|tn dept|flhsmv office locator|synchrony public|cisa|\.gov registry)",
    r"\bregistry\b", r"\bunverified\b", r"\bverify (it|that|this)\b", r"\bcould not\b", r"\bcouldn't\b",
    r"\bnot (found|confirmed|verified)\b", r"\bnot visible\b", r"\bwas not\b.*\b(found|listed|visible)\b",
    r"\btypical credit-union\b", r"\bhigh-cost support\b", r"\bsac:\s*\d", r"\bid (ldc)?\d+\b",
    r"\bhq\b", r"\bheadquartered\b", r"\bguessed\b", r"\bresearch(ed|er)?\b", r"\bentry\b", r"\bentries\b",
    r"\bnull\b", r"\blinks? (reused|shared|copied) from\b", r"\breused\b", r"\bmatched\b", r"\bmatch(es)? (the|its)\b",
    r"\blisted (in|on|by) (the )?(state|county|municipal|federal)\b.*\b(list|directory)\b",
    r"^(phone|website|url|pay link|links?)( and [a-z ]+)?:", r"^website\b", r"^official site\b",
    r"\bfirst (number|phone) listed\b", r"\bnot necessarily a billing\b", r"\bregulatory contact\b",
    r"\badministrative contact\b", r"\bcontact e-?mail domain\b", r"\bowner type [a-z]\b",
    r"\bmay not be the billing office\b", r"\bdid not (name|list|show|mention|say|state)\b",
    r"\bno\b[^.]{0,80}\b(was|were) (found|listed|located|mentioned|shown|published)\b",
    r"\bnot (listed|mentioned|stated|published) (on|in)\b", r"^(rates?|credits?|phone|data|figures?)\b[^.]* from\b",
    r"\b(tax rate|dealer licen[cs]e) (table|list)\b", r"\bper (its|the) (published|public)\b.*\blist\b",
    r"\bspot-?check", r"\blink targets?\b", r"\bnot individually\b", r"\bmarked verified\b",
    r"\bstatus-checked\b", r"\badded where found\b", r"\b(added|found) (missing )?links?\b", r"\bsitemap\b",
    r"\bpages? checked\b", r"\bon the pages\b", r"\bno (official )?(web)?site\b", r"\bno website\b", r"\bfound via\b",
    r"\bas listed (by|on|in)\b", r"\bthe first listed\b", r"\bgenerated from\b", r"\bwas found\b", r"\bnot found\b",
    r"\bno [\w/ -]{1,40} found\b", r"\bmay be outdated\b", r"\bpage contents\b", r"\bslimmer\b", r"\bwikipedia\b",
    r"\b(is|are) listed here\b", r"\blisted here\b", r"\bnames the pha\b", r"\bpresence of a page\b",
    r"\bcredit card agreement database\b", r"\bon-page context\b", r"\b(fa|faq) page\)", r"\bas filed\b",
    r"\b(view_bill|pay_bill|autopay_setup|autopay_cancel|statements_history|payment_assistance|login_url|"
    r"help_center_url|phone_customer_service|phone_pay_by_phone|mail_payment_address|senior_programs)\b",
    r"\bhomepage\b", r"\b(old|parked|previous|former) (domain|url|website|site)\b", r"\breview fix\b", r"\bnone recorded\b", r"\btext-attributed\b", r"\bnot recorded\b", r"\bhome page\b", r"\btier\b",
]), re.I)

# Inline asides to cut from sentences that are otherwise kept.
ASIDE = re.compile("|".join([
    r"\s*\((?:[^()]*\b(?:fetched|page title|checked|verified|auto-?extracted|this session|"
    r"not researched|from (?:the )?(?:cms|epa|hud|hifld|eia|fcc)|20\d\d-\d\d-\d\d|roster|dataset)\b[^()]*)\)",
]), re.I)
TAG = re.compile(r"^\s*\[?\s*[A-Za-z0-9 ()/#.-]{0,40}?\b(?:backfill|review(?:er)?|upgraded?|audit|url check|gap-?fill|"
                 r"re-?check(?:ed)?)\b[^:\]]{0,80}?(?::|\]|$)\s*", re.I)


ABBR = re.compile(r"\b(P\.\s?O|U\.S|St|Mt|Dr|No|Nos|Inc|Co|Corp|Ave|Blvd|Rd|Ste|Jr|Sr|e\.g|i\.e|a\.m|p\.m|vs|etc|"
                  r"approx|Dept|Twp|Ft|Hwy|Pkwy|Apt|Bldg|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|Jun|Jul|"
                  r"Aug|Sep|Sept|Oct|Nov|Dec|Mr|Mrs|Ms)\.", re.I)


def sentences(text):
    text = re.sub(r"\s+", " ", text).strip()
    held = []

    def hold(m):
        held.append(m.group(0))
        return f"\x00{len(held) - 1}\x00"

    # Remove research asides in parentheses (innermost first); hold the rest so they
    # are not split apart.
    while True:
        m = re.search(r"\([^()]*\)", text)
        if not m:
            break
        inner = m.group(0)
        restored = re.sub(r"\x00(\d+)\x00", lambda k: held[int(k.group(1))], inner)
        text = text[:m.start()] + ("" if DROP.search(restored) else hold(m)) + text[m.end():]
    text = re.sub(r"'[^'\s][^']{0,150}?'(?=[\s.,;:)]|$)|\"[^\"]{1,150}\"", hold, text)
    text = ABBR.sub(lambda m: m.group(0)[:-1] + "\x01", text)
    text = re.sub(r"(?<=\d)\.(?=\d)", "\x01", text)
    # Open bracketed research blocks so their facts can be judged one by one.
    text = re.sub(r"\[([^\[\]]*)\]", lambda m: " " + m.group(1) + ". ", text)
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\x00\"'(])|\s+\|\s+", text)

    def restore(p):
        while "\x00" in p:
            p = re.sub(r"\x00(\d+)\x00", lambda k: held[int(k.group(1))], p)
        return p.replace("\x01", ".")
    return [restore(p).strip() for p in parts if p and p.strip()]


REWRITE = [
    (re.compile(r"^Main hospital phone listed(; ask for Patient Financial Services/billing)?\.?$", re.I),
     "The phone number is the hospital's main line; ask for Patient Financial Services (billing)."),
    (re.compile(r"^Typical credit-union bill-related features \(loan/credit-card payment by transfer, online Bill Pay, "
                r"eStatements\) are usually inside online banking; check the website's 'Make a Payment' or 'Loan Payments' page\.?$", re.I),
     "Loan and credit-card payments, online Bill Pay and eStatements are usually inside online banking; "
     "look for the website's 'Make a Payment' or 'Loan Payments' page."),
    (re.compile(r"^CMS DY\d+ ambulance supplier roster; use billing phone/portal on the bill\.?$", re.I),
     "Use the billing phone number or payment portal printed on the ambulance bill."),
    (re.compile(r"^(?:CMS Doctors & Clinicians group roster; )?health-system groups bill via the system.*$", re.I),
     "Groups owned by a health system bill through that system's patient billing office."),
]


def clauses_of(s):
    """Split on ';' and dashes that are not inside parentheses."""
    out, depth, start = [], 0, 0
    for m in re.finditer(r"[()]|;\s+|\s+[—–]\s+|\s+--\s+", s):
        t = m.group(0)
        if t == "(":
            depth += 1
        elif t == ")":
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(s[start:m.start()])
            start = m.end()
    out.append(s[start:])
    return [c.strip() for c in out if c.strip()]


def keep_clause(c):
    if not DROP.search(c):
        return c
    # "Fetched this session: the facts" -> keep the facts.
    head, sep, rest = c.partition(": ")
    if sep and len(head) <= 60 and "(" not in head and DROP.search(head) and rest and not DROP.search(rest):
        return rest
    return None


def clean_sentence(s):
    s = TAG.sub("", s).strip()
    for pat, rep in REWRITE:
        if pat.match(s):
            return rep
    # Judge "a; b" and "a — b" clauses separately so one research aside doesn't sink the fact.
    s = "; ".join(k for k in (keep_clause(c) for c in clauses_of(s)) if k)
    if not s:
        return None
    s = ASIDE.sub("", s).strip()
    s = re.sub(r"\s+([.,;:])", r"\1", s)
    s = s.strip(" ;,-")
    if len(re.sub(r"[^A-Za-z]", "", s)) < 12:
        return None
    if s[-1] not in ".!?)\"'":
        s += "."
    return s[0].upper() + s[1:]


REVIEW = {}
for _p in glob.glob(os.path.join(HERE, "rosters", "_raw", "clean", "review_out", "*.json")):
    REVIEW.update(json.load(open(_p)))


def clean_text(text, name=None):
    out, seen = [], set()
    if name:
        seen.add(name.strip().rstrip(".").lower() + ".")
    for s in sentences(text):
        c = clean_sentence(s)
        if c and c in REVIEW:
            c = REVIEW[c].strip() or None
        if c and c.lower() not in seen:
            seen.add(c.lower())
            out.append(c)
    return " ".join(out) or None


def key(field, text):
    return hashlib.sha1((field + "\0" + text).encode()).hexdigest()[:16]


def load_rewrites():
    rw = {}
    for p in glob.glob(os.path.join(HERE, "rosters", "_raw", "clean", "out", "*.json")):
        try:
            rw.update(json.load(open(p)))
        except Exception:
            pass
    return rw


def main():
    files = sorted(glob.glob(os.path.join(HERE, "categories", "*.json")))
    rewrites = load_rewrites()
    if "--sample" in sys.argv or "--residual" in sys.argv:
        texts = [(f, e.get(f)) for p in files for e in json.load(open(p))["entries"]
                 for f in ("notes", "senior_programs") if e.get(f)]
        if "--sample" in sys.argv:
            random.seed(int(os.environ.get("SEED", 1)))
            for f, t in random.sample(texts, int(sys.argv[sys.argv.index("--sample") + 1])):
                print(f"--- {f}\nIN : {t[:900]}\nOUT: {clean_text(t)}\n")
        else:
            susp = re.compile(r"\b(fetch|verif|roster|dataset|backfill|review|research|checked|found|listed|source|"
                              r"crawl|probe|title|session|missing|unknown|unclear|confirmed|domain|entry|link|reuses?|points? to|"
                              r"not (documented|published|stated|shown)|linked|inferred|evidence|candidate|removed|replaced|"
                              r"unchanged|taken from|not opened|browser|blocked|bot|script|based on|this is the|null)\w*", re.I)
            c = collections.Counter()
            for f, t in texts:
                for s in sentences(t):
                    k = clean_sentence(s)
                    if k and susp.search(k):
                        c[re.sub(r"\d", "#", k)[:160]] += 1
            print("suspect kept sentences:", sum(c.values()), "unique:", len(c))
            if "--export" in sys.argv:
                exact = collections.Counter()
                for f, t in texts:
                    for s in sentences(t):
                        k = clean_sentence(s)
                        if k and susp.search(k) and k not in REVIEW:
                            exact[k] += 1
                d = os.path.join(HERE, "rosters", "_raw", "clean", "review_in")
                os.makedirs(d, exist_ok=True)
                items = sorted(exact)
                n = int(os.environ.get("CHUNKS", 4))
                for i in range(n):
                    json.dump(items[i::n], open(os.path.join(d, f"{i}.json"), "w"), ensure_ascii=False, indent=0)
                print("exported", len(items), "sentences in", n, "files to", d)
                return
            for k, n in c.most_common(int(os.environ.get("TOP", 120))):
                print(n, k)
        return
    stats = collections.Counter()
    for p in files:
        doc = json.load(open(p))
        for e in doc["entries"]:
            for f in ("notes", "senior_programs"):
                t = e.get(f)
                if not isinstance(t, str) or not t.strip():
                    continue
                k = key(f, t)
                new = (rewrites[k].strip() or None) if k in rewrites else clean_text(t, e.get("name"))
                stats["rewrite" if k in rewrites else "rules"] += 1
                stats["emptied"] += new is None
                e[f] = new
        json.dump(doc, open(p, "w"), indent=1, ensure_ascii=False)
    print(dict(stats))


if __name__ == "__main__":
    main()
