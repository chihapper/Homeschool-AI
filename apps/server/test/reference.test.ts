import { describe, expect, it } from "vitest";
import {
  articleContents,
  articlePassages,
  createWikipediaClient,
  permalink,
  referenceBrief,
  renderBrief,
  sectionText,
  wikipediaUserAgent,
  type WikiArticle,
  type WikipediaClient,
} from "../src/reference/wikipedia.js";
import { checkClaim, type CheckVerdict } from "../src/agents/reference-agent.js";

const aeneas: WikiArticle = {
  title: "Aeneas",
  url: permalink("Aeneas", 42),
  revisionId: 42,
  quality: "C",
  text: [
    "In Greco-Roman mythology, Aeneas was a Trojan hero, the son of the Trojan prince Anchises and the goddess Aphrodite.",
    "== Homer's Iliad ==",
    "Aeneas is a minor character in the Iliad, where he is twice saved from death by the gods.",
    "Aphrodite carries him out of the fight with Diomedes, and Apollo takes him to Pergamos.",
    "=== Later in the war ===",
    "Poseidon lifts him away from Achilles.",
    "== Virgil's Aeneid ==",
    "Aeneas leads the Trojans to Latium, where his descendants Romulus and Remus will found Rome.",
    "== References ==",
    "Homer, Iliad, Book 5.",
    "=== Primary sources ===",
    "Virgil, Aeneid.",
  ].join("\n"),
};

describe("reading a Wikipedia article", () => {
  it("names this program and a contact in every request, as Wikimedia requires, and refuses to run without one", () => {
    expect(wikipediaUserAgent("parent@example.com")).toMatch(/^ReferenceCheck\/[\d.]+ \(parent@example\.com\) Node\.js\//);
    expect(() => wikipediaUserAgent(undefined)).toThrow(/WIKIPEDIA_CONTACT/);
    expect(() => wikipediaUserAgent("  ")).toThrow(/10 requests a minute/);
  });

  it("links to the exact version that was read", () => {
    expect(permalink("Founding of Rome", 7)).toBe("https://en.wikipedia.org/w/index.php?title=Founding_of_Rome&oldid=7");
    expect(permalink("Aeneas")).toBe("https://en.wikipedia.org/wiki/Aeneas");
  });

  it("cuts an article into passages labelled with their section, leaving out the references", () => {
    const passages = articlePassages(aeneas);
    expect(passages.map((p) => p.section)).toEqual(["Introduction", "Homer's Iliad", "Later in the war", "Virgil's Aeneid"]);
    expect(passages.some((p) => /Book 5|Primary sources/.test(p.text))).toBe(false);
    expect(articleContents(aeneas)).toEqual(["Homer's Iliad", "  Later in the war", "Virgil's Aeneid"]);
  });

  it("gives a whole section, subsections included, for a second look", () => {
    const s = sectionText(aeneas, "homer's  iliad");
    expect(s?.section).toBe("Homer's Iliad");
    expect(s?.text).toContain("Aphrodite carries him");
    expect(s?.text).toContain("Poseidon lifts him");
    expect(sectionText(aeneas, "No such section")).toBeUndefined();
  });

  it("gives the checker each article's summary and contents, and the passages that match the claim", () => {
    const brief = referenceBrief([aeneas], "Aphrodite saved Aeneas from Diomedes");
    expect(brief.articles[0].summary).toMatch(/goddess Aphrodite/);
    expect(brief.articles[0].contents).toContain("Homer's Iliad");
    expect(brief.passages[0].section).toBe("Homer's Iliad");
    // The summary is shown once, not again among the passages.
    expect(brief.passages.some((p) => p.section === "Introduction")).toBe(false);
    expect(renderBrief(brief)).toContain('<passage article="Aeneas" section="Homer\'s Iliad">');
  });
});

/** A fake of the Action API: answers by `list`/`prop`, records every request. */
function fakeApi(opts: { busyFirst?: number } = {}) {
  const calls: Array<{ url: URL; headers: Record<string, string> }> = [];
  let busy = opts.busyFirst;
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = async (url: string, init: { headers: Record<string, string> }) => {
    const u = new URL(url);
    calls.push({ url: u, headers: init.headers });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    const json = (body: unknown) => ({ ok: true, status: 200, statusText: "OK", headers: new Headers(), json: async () => body });
    if (busy !== undefined) {
      const retry = busy;
      busy = undefined;
      return { ok: false, status: 429, statusText: "Too Many Requests", headers: new Headers({ "retry-after": String(retry) }), json: async () => ({}) };
    }
    if (u.searchParams.get("list") === "search") {
      return json({ query: { search: [{ title: "Aeneas" }, { title: "Aeneas (disambiguation)" }, { title: "Aeneid" }] } });
    }
    const title = u.searchParams.get("titles");
    if (title === "Aeneas") {
      return json({ query: { pages: [{ title: "Aeneas", extract: aeneas.text, revisions: [{ revid: 42, timestamp: "2026-09-21T00:00:00Z" }], pageassessments: { Classics: { class: "C" }, Mythology: { class: "C" } } }] } });
    }
    if (title === "Aeneas (film)") return json({ query: { pages: [{ title, extract: "A film.", pageassessments: { Film: { class: "Disambig" } } }] } });
    return json({ query: { pages: [{ title, missing: true }] } });
  };
  return { fetch, calls, maxInFlight: () => maxInFlight };
}

describe("the Wikipedia client", () => {
  it("searches without disambiguation pages, identifying itself with the contact", async () => {
    const api = fakeApi();
    const wiki = createWikipediaClient({ contact: "parent@example.com", fetch: api.fetch });
    expect(await wiki.search("Aeneas")).toEqual(["Aeneas", "Aeneid"]);
    expect(api.calls[0].headers["User-Agent"]).toContain("(parent@example.com)");
    expect(api.calls[0].url.searchParams.get("format")).toBe("json");
  });

  it("reads an article with its version and grade, and skips missing and disambiguation pages", async () => {
    const wiki = createWikipediaClient({ contact: "c", fetch: fakeApi().fetch });
    const a = await wiki.article("Aeneas");
    expect(a).toMatchObject({ title: "Aeneas", revisionId: 42, quality: "C", url: permalink("Aeneas", 42) });
    expect(await wiki.article("Nobody")).toBeUndefined();
    expect(await wiki.article("Aeneas (film)")).toBeUndefined();
  });

  it("downloads each article and search once a day, and one request at a time", async () => {
    let t = 0;
    const api = fakeApi();
    const wiki = createWikipediaClient({ contact: "c", fetch: api.fetch, now: () => t });
    await Promise.all([wiki.article("Aeneas"), wiki.search("aeneas"), wiki.search("Aeneas ")]);
    await wiki.article("Aeneas");
    expect(api.calls).toHaveLength(3); // one article; the second search raced the first, then both are cached
    expect(api.maxInFlight()).toBe(1);
    t = 25 * 60 * 60 * 1000;
    await wiki.article("Aeneas");
    expect(api.calls).toHaveLength(4);
  });

  it("waits out a short retry-after once, and fails readably on a long one", async () => {
    const waits: number[] = [];
    const short = fakeApi({ busyFirst: 5 });
    const wiki = createWikipediaClient({ contact: "c", fetch: short.fetch, sleep: async (ms) => void waits.push(ms) });
    expect(await wiki.search("Aeneas")).toContain("Aeneas");
    expect(waits).toEqual([5000]);

    const long = createWikipediaClient({ contact: "c", fetch: fakeApi({ busyFirst: 120 }).fetch, sleep: async () => {} });
    await expect(long.search("Aeneas")).rejects.toThrow(/slow down \(429 Too Many Requests, retry after 120 s\)/);
  });
});

describe("checking one claim", () => {
  const wiki: WikipediaClient = { search: async (q) => (/aeneas/i.test(q) ? ["Aeneas"] : []), article: async (t) => (t === "Aeneas" ? aeneas : undefined) };
  const verdict = (v: Partial<CheckVerdict>): CheckVerdict => ({ verdict: "supported", explanation: "", evidence: "", articleTitle: "", sectionToRead: "", sayToLearner: "", ...v });

  it("gives the checker a second look at the section it asks for, and then makes it decide", async () => {
    const looks: Array<{ reference: string; final: boolean }> = [];
    const judge = async (_: unknown, reference: string, final: boolean) => {
      looks.push({ reference, final });
      return looks.length === 1
        ? verdict({ verdict: "read-more", sectionToRead: "Homer's Iliad" })
        : verdict({ verdict: "contradicted", explanation: "In the Iliad, Aphrodite, Apollo and Poseidon save him.", evidence: "Poseidon lifts him away from Achilles.", articleTitle: "Aeneas" });
    };
    const out = await checkClaim({ claim: "McDonald's rescued Aeneas during the Trojan War.", query: "Aeneas" }, { wiki, judge });
    expect(looks.map((l) => l.final)).toEqual([false, true]);
    expect(looks[1].reference).toContain('<section article="Aeneas" heading="Homer\'s Iliad">');
    expect(out).toMatchObject({ status: "checked", verdict: "contradicted", evidence: "Poseidon lifts him away from Achilles.", source: { title: "Aeneas", revisionId: 42, url: permalink("Aeneas", 42) } });
  });

  it("reads the subject's own article before search results (search once found the wrong Constantine)", async () => {
    const great: WikiArticle = { title: "Constantine the Great", url: permalink("Constantine the Great", 9), revisionId: 9, text: "Constantine I was a Roman emperor from AD 306 to 337." };
    const xi: WikiArticle = { title: "Constantine XI Palaiologos", url: permalink("Constantine XI Palaiologos", 8), revisionId: 8, text: "Constantine XI was the last Byzantine emperor." };
    const wiki2: WikipediaClient = {
      search: async () => ["Constantine XI Palaiologos", "Constantine the Great"],
      article: async (t) => (t === "Constantine the Great" ? great : t === "Constantine XI Palaiologos" ? xi : undefined),
    };
    const seen: string[] = [];
    const judge = async (_: unknown, reference: string) => {
      seen.push(reference);
      return verdict({ explanation: "Emperor from 306.", evidence: "a Roman emperor from AD 306 to 337", articleTitle: "Constantine the Great" });
    };
    const out = await checkClaim({ claim: "Constantine became emperor in 306.", query: "Constantine the Great" }, { wiki: wiki2, judge });
    expect(seen[0].indexOf('title="Constantine the Great"')).toBeLessThan(seen[0].indexOf('title="Constantine XI Palaiologos"'));
    expect(out).toMatchObject({ verdict: "supported", evidence: "a Roman emperor from AD 306 to 337", source: { title: "Constantine the Great", revisionId: 9 } });
  });

  it("passes on the sentence the checker wrote for the tutor, but none for faith", async () => {
    const said = "I looked that up: your brother was right, the Aeneid really does have 9,896 lines.";
    const out = await checkClaim({ claim: "Aphrodite saved Aeneas.", query: "Aeneas", tutorStance: "unsure" }, { wiki, judge: async () => verdict({ sayToLearner: `  ${said} ` }) });
    expect(out.sayToLearner).toBe(said);
    const faith = await checkClaim({ claim: "God planned it.", query: "Aeneas" }, { wiki, judge: async () => verdict({ verdict: "not-checkable", sayToLearner: "Something." }) });
    expect(faith.sayToLearner).toBeUndefined();
  });

  it("drops a quotation that is not word for word in what was read", async () => {
    const judge = async () => verdict({ explanation: "The Iliad says so.", evidence: "Aphrodite personally rescued Aeneas", articleTitle: "Aeneas" });
    const out = await checkClaim({ claim: "Aphrodite saved Aeneas.", query: "Aeneas" }, { wiki, judge });
    expect(out.verdict).toBe("supported");
    expect(out.evidence).toBeUndefined();
  });

  it("leaves faith and values unchecked, and reports a subject Wikipedia has no article on", async () => {
    const faith = await checkClaim({ claim: "God prepared the Empire for the coming of Christ.", query: "Aeneas" }, { wiki, judge: async () => verdict({ verdict: "not-checkable" }) });
    expect(faith).toMatchObject({ status: "not-checked", statusNote: expect.stringMatching(/faith, values or interpretation/) });
    const none = await checkClaim({ claim: "Zorblax founded Rome.", query: "Zorblax" }, { wiki, judge: async () => verdict({}) });
    expect(none).toMatchObject({ status: "checked", verdict: "not-found", explanation: expect.stringMatching(/no article/) });
  });
});
