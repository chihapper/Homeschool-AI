# Where this product stands against Khanmigo and the rest

Written 2026-09-28, after the user asked whether the product duplicates Khanmigo. The answer rests on a
research pass over the products' own pages (Opus 5.5 agent, read-only, 48 sources), appended in full below.
`docs/RESEARCH.md` §4 has the original positioning from 2026-09-23; this confirms it against the 2026
products.

## The verdict

**No product found does the four things together that this one is built on**: takes in the family's own
material, keeps the tutoring inside it, talks with the child in real time, and gives the parent a mastery
report. Each exists somewhere; the combination does not.

| | Own material | Constrained to it | Live voice | Parent report | Price | Under-13 |
|---|---|---|---|---|---|---|
| **Khanmigo** | Photos only (a "Tutor Me" snapshot, math and science) | No: tutors Khan's own content | No: turn-based, speech to text after a pause, reply as text then read aloud | Transcripts, activity, mastery on Khan content, alerts on flagged chats | $4/month, US billing | Parent-created account; the no-training clause is stated for schools only |
| **ChatGPT Study Mode** | Yes, uploads on all plans | No; may just give the answer | Real-time voice exists; whether Study Mode works in it is unconfirmed | None; parents can set hours and switch voice or memory off, not read chats | $0–$100+/month | Not allowed; teens' chats train by default |
| **Gemini Guided Learning** | Yes, uploads | Not documented | Real-time voice exists; whether Guided Learning works in it is unconfirmed | None; Family Link on/off and a first-use email | $0–$99.99+/month | Family Link (not EEA/UK/CH); not used for training |
| **Gemini Notebook** (was NotebookLM) | Yes | **Yes**, answers only from the sources | Rolling out from 2026-09-15 to paying 18+ subscribers first | None | Free; voice on the top plan | 13+ |
| **Synthesis Tutor** | No: its own K–5 math | n/a | Reads aloud; child's voice unconfirmed | Progress reports (contents unconfirmed) | $119/year | COPPA consent |
| **Sage** (homeschool-marketed) | Regional curriculum frameworks plus homework photos | No | Tap-to-talk | Weekly briefing, report cards | $239.99/year | Parent-created; not used for training |
| **TutorBook** (homeschool page) | Uploads of textbooks and worksheets, turned into audio lessons and quizzes | Unconfirmed | Unconfirmed | A parent guide | $0–$39.99/month | Consent; data improves its AI |
| **This product** | Yes: the parent's own unit, any format | Yes, and the assessor audits every tutor claim against it | Yes, with interruption (the COPPA voice question is open, #13) | Mastery per concept, misconceptions, grounding audit, progress across sessions, the profile and course record | Not set; cost per session is #20 | Open, #13 |

Gemini Notebook is the nearest on the two hard properties, grounding and live voice, and it has no
pedagogy, no mastery model, no parent view, and reaches adults first.

## What the check adds to the positioning

1. **Khanmigo does not tutor on a family's material.** Its only upload is a photo for math and science; a
   search of its 127 help-centre articles found no document, PDF or reading-list upload, and there is no
   homeschool plan (Khan's homeschool article ends by suggesting Khanmigo as an add-on). A Charlotte Mason
   booklist, an Orthodox history guide, or any purchased unit cannot be pointed at it. That was the core claim
   of 2026-09-23 and it holds.
2. **Constraint is the rare property.** The big-lab modes take uploads but stay free to say anything; Study
   Mode's own help page says it may just give the answer. Only Gemini Notebook is constrained, and it is a
   research tool, not a tutor. "Teaches only from your material, and here is the audit" is still ours to
   say.
3. **Live voice for a child is rarer than it looks.** Khanmigo is turn-based; the big labs have real-time
   voice for adults and have not documented their learning modes inside it; Notebook's voice is 18+ first.
   Our browser voice with barge-in is ahead here, and the amended COPPA rule (voiceprints) is the thing that
   could slow us; #13.
4. **Parents get transcripts elsewhere, not judgement.** Khanmigo gives parents chat transcripts, activity
   and Khan-content mastery; the labs give parents switches; Sage gives a weekly briefing. A per-concept
   mastery report from the conversation itself, with misconceptions and a grounding audit, is not on offer
   anywhere in the table.
5. **The Khanmigo evidence is a warning for everyone, including us.** A two-year randomised trial in 18
   Tennessee middle schools found +1.3 national percentile ranks per term, about 0.06–0.08 standard
   deviations a year, and the authors say the gains "resemble those from Khan Academy practice without AI
   assistance"; the typical student messaged the tutor on a third of the days they practised, and in 17 % of
   sessions where they made a mistake; Khan's own tests show answers leak. Engagement and real learning gains
   are the risk, not features. The evaluation harness (#6) and the assessor's giveaway count are how we would
   know we are doing better.
6. **Price anchors.** $4 a month (Khanmigo), $119 a year (Synthesis), $239.99 a year (Sage). Our cost per
   session, two offline Opus calls plus the tutor and voice, has to fit under a number in that range; #20.

## What to watch

- Gemini Notebook adding a parent view or a younger voice tier: that would be the closest thing to us.
- Khan adding document upload to Khanmigo (the district version now sits inside practice problems; the
  learner version is unchanged).
- Sage or TutorBook constraining their tutoring to the family's material; TutorBook already takes uploads.

## Where the moat is, honestly

Not in any single feature: uploads, Socratic prompting, voice and parent views each exist somewhere, and the
big platforms could add the rest. It is in being the tool a homeschool family trusts with *their* curriculum
and *their* child: teaching only from the material they chose and proving it, handling faith and values
their way, telling them where their child stands in the material's own terms, and holding their data where
they can see it. Those are product rules and a market focus, not features, and none of the products above is
optimising for them.

---

# Appendix. The research report as delivered (2026-09-28)

Opus 5.5 research agent, read-only; nothing about this product was described to anyone. Reproduced unedited
except for this heading.

Read 2026-09-28. [n] = sources below (with the page's date where it shows one). UNCONFIRMED = could not verify.

## Khanmigo

**1. Who, price.**
- Learner and Parent plans cost $4/month or $44/year; the Parent plan covers up to 10 children. The buyer must be 18+ with a US billing address [1][4].
- Teachers: free, but without the student tutor [4].
- No homeschool plan. Khan's homeschool help article ends by suggesting Khanmigo as an add-on [5], and an Aug 2026 homeschool post offers a free first month [6].
- No free learner tier is listed [1]. Separately, Khanmigo Lite is a custom GPT inside ChatGPT that runs under OpenAI's privacy terms [21].

**2. Content.**
- Sold as tutoring on Khan's own content [1]. A separate activities page adds activities not tied to Khan content [7].
- The only upload is a PNG/JPEG photo in the Tutor Me activity (math and science). Photos are not stored [2].
- Searching Khan's help center (127 Khanmigo articles) turned up no PDF, document or reading-list upload.
- The 2026 version, built into practice problems, is listed for school-district partners. Independent learners keep the existing version [8][9].

**3. Teaching.** It promises never to give the answer. It covers math, science, coding, history and humanities, from elementary school through college [3]. Khan's own tests show answers do leak; one change halved how often [10].

**4. Voice.** Turn-based, not live. Speech becomes text after the child pauses (English only). The reply appears as text first, then is read aloud [12].

**5. Parent/teacher view.**
- Parents see activity by Khan course and assignment scores [5], plus full chat transcripts and email alerts on flagged chats [13][14].
- Parent tools include a chat-history summarizer and a class snapshot showing course mastery, for Khan content only [13][15].
- District teachers get usage reports [16].

**6. Memory.** Opt-in Interests are inferred from chats, editable, visible to parents, and kept until the account is deleted [17][18]. Khan has tested feeding the tutor recent practice, unmastered prerequisite skills, and 24 hours of chats on the same skill [10].

**7. Data.**
- Under-18s get access only through a parent, a school district, or an essay assigned in Khan's Writing Coach [11]. Accounts for under-13s are parent-created and restricted [22].
- Chats stay viewable for up to 365 days, and flagged chats are kept 2 years. De-identified chats may be used to improve products [18].
- The privacy policy's ban on AI providers training on user input appears in its Schools section [19]. For family accounts: UNCONFIRMED.
- Models: OpenAI [20], with Gemini for diagrams [23].

**8. Evidence.**
- A two-year randomized trial in 18 Tennessee middle schools: +1.3 national percentile ranks per term, about 0.06–0.08 standard deviations a year (the usual measure of effect size).
- The authors: "These gains resemble those from Khan Academy practice without AI assistance."
- The typical student messaged Khanmigo on a third of the days they practised, and in 17% of sessions where they made a mistake [24][25].
- Khan's own experiments: +6.1% on getting the next problem right, measured in-product [10].
- Sal Khan told Chalkbeat that many students barely used it [26].

## ChatGPT Study Mode
- **Own material:** yes, on all plans. It can use uploaded notes, syllabi and PDFs [27].
- **Constrained:** no. It isn't limited to the uploads, doesn't work in Projects (ChatGPT's saved-file folders), and may sometimes just give the answer [27].
- **Voice:** ChatGPT's voice is real-time and can be interrupted [29]. Whether study mode works in voice: UNCONFIRMED.
- **Parent report:** none. Parents can schedule study hours and turn off voice or memory, but cannot read chats [28].
- **Price:** $0/$8/$20/$100+ per month [30].
- **Data:** users must be 13+, and under-18s need parental permission [31]. For teens, training on their chats is on by default [28].

## Gemini Guided Learning (LearnLM)
- **Own material:** yes. It builds on LearnLM, Google's teaching-tuned models, now part of Gemini [32], and accepts uploaded files and images [33].
- **Constrained:** not documented.
- **Voice:** Gemini Live is real-time. Whether Guided Learning works in it: UNCONFIRMED.
- **Parent report:** none. Under-13s can use it through Family Link, Google's parent-managed accounts (not in the EEA, UK or Switzerland). A parent switches it on or off and is emailed on first use [34].
- **Price:** $0/$4.99/$19.99/$99.99+ per month [35].
- **Data:** with the Keep Activity chat-history setting on, chats train Google's models and may be human-reviewed. With it off, chats are kept 72 hours and not trained on [36]. Under-13s can't turn it on [34], and a Google spokesperson said children's data won't be used for training [37].

**Gemini Notebook (formerly NotebookLM):**
- Answers are grounded in the user's uploaded sources [38].
- Real-time voice that can be interrupted is rolling out from 2026-09-15, first to AI Ultra subscribers aged 18+ [38].
- Users must be 13+. Chats and uploads aren't human-reviewed or used for training [39].
- No parent report found.

## Synthesis Tutor
- **Own material:** none; its own K–5 math, ages 5–11 [40].
- **Voice:** reads aloud [40]. Voice answers from the child: UNCONFIRMED.
- **Parent report:** progress reports listed [40] (contents UNCONFIRMED).
- **Price:** $29/month or $119/year for up to 7 children [40].
- **Data:** its COPPA policy (the US children's-privacy law), dated 2026-06-10, keeps data for the service's life plus 30 days and may use it to improve the service. AI training isn't addressed [41].

## Homeschool tutors on the family's own curriculum
**None found** that ingests a family's own curriculum and keeps tutoring within it. Searches included:
- AI tutor for homeschool families that uses your own curriculum upload
- bring your own curriculum AI tutor kids
- upload your textbook homeschool Socratic voice
- AI tutor Charlotte Mason narration homeschool app

Nearest:
- **Sage:** marketed to homeschool families.
  - Teaches from regional curriculum frameworks, plus homework photos.
  - Tap-to-talk voice, and a weekly briefing and report cards for parents.
  - $239.99/year per household.
  - Runs on Anthropic's Claude; transcripts aren't used for training [42][43].
- **TutorBook:** its homeschool page invites uploads of textbooks, worksheets or photos.
  - Audio lessons, quizzes and a parent guide, for K–8.
  - Free, or $39.99/month.
  - Keeps data partly to improve its AI.
  - UNCONFIRMED: whether it stays within the uploads, whether voice is live, and whether parents get a mastery report [44][45][46].
- **LittleLit:** its own curriculum; $299 per child per year [47].
- OpenEd's Jan 2026 review of homeschool AI tutors names none [48].

## Comparison
| | Own material | Constrained | Live voice | Parent report | Price | Under-13 |
|---|---|---|---|---|---|---|
| Khanmigo | Photos | No | No | Transcripts, Khan mastery | $4/mo, US | Parent account; no-training clause is schools-only |
| ChatGPT | Yes | No | Yes* | No | $0–$100+ | Not allowed |
| Gemini Guided | Yes | No | Yes* | No | $0–$99.99+ | Family Link; not trained on |
| Gemini Notebook | Yes | Yes | 18+ first | No | Free; voice on Ultra | Not allowed (consumer accounts) |
| Synthesis | No | n/a | Read-aloud | Progress reports | $119/yr | COPPA consent |
| Sage | Photos | No | Tap-to-talk | Weekly | $239.99/yr | Parent-made; not trained on |
| TutorBook | Yes | UNCONFIRMED | UNCONFIRMED | Guide | $0–$39.99/mo | Consent; data improves AI |

*Voice exists; whether the tutoring mode works in it: UNCONFIRMED.

**Bottom line:**
- Khanmigo overlaps on withholding answers and giving parents transcripts. It does not tutor from the family's own material and has no live voice.
- ChatGPT and Gemini take uploads but don't stay within them or report to parents.
- Gemini Notebook is closest, with grounded answers and live voice. But voice is adults-first, and there's no parent view.

## Sources
1. https://www.khanmigo.ai/pricing ; https://www.khanmigo.ai/parents (undated)
2. https://support.khanacademy.org/hc/en-us/articles/36868912022541 (2025-10-06); https://support.khanacademy.org/hc/en-us/articles/46962842660749 (2026-06-30)
3. https://www.khanmigo.ai/learners (undated)
4. https://support.khanacademy.org/hc/en-us/articles/25921448458893 (2025-03-13); https://support.khanacademy.org/hc/en-us/articles/13982227159437 (2024-07-17)
5. https://support.khanacademy.org/hc/en-us/articles/36065978206221 (2026-09-01)
6. https://blog.khanacademy.org/free-back-to-school-resources-for-families-and-homeschoolers/ (2026-08-05)
7. https://support.khanacademy.org/hc/en-us/articles/13982652883341 (2024-10-16)
8. https://blog.khanacademy.org/khanmigos-first-chapter-changed-how-i-think-about-ai-a-note-from-sal-khan/ (2026-07-15)
9. https://support.khanacademy.org/hc/en-us/articles/46056261189773 (2026-06-10)
10. https://blog.khanacademy.org/how-khan-academy-is-building-a-better-ai-tutor-our-most-recent-learnings/ (2026-05-01)
11. https://support.khanacademy.org/hc/en-us/articles/13965308352781 (2026-02-25)
12. https://support.khanacademy.org/hc/en-us/articles/37785606729101 (2025-07-02); https://support.khanacademy.org/hc/en-us/articles/23772334788365 (2025-06-27); https://support.khanacademy.org/hc/en-us/articles/33322691603469 (2025-12-04)
13. https://support.khanacademy.org/hc/en-us/articles/21823169137037 (2025-06-12)
14. https://support.khanacademy.org/hc/en-us/articles/14394854880909 (2025-07-10)
15. https://support.khanacademy.org/hc/en-us/articles/14799047733645 (2026-07-07)
16. https://support.khanacademy.org/hc/en-us/articles/29473549307277 (2024-10-16)
17. https://blog.khanacademy.org/new-khanmigo-interests (2023-09-06; updated 2025-03-21)
18. https://support.khanacademy.org/hc/en-us/articles/29415446635021 (2024-12-03)
19. https://www.khanacademy.org/about/privacy-policy (no date shown)
20. https://support.khanacademy.org/hc/en-us/articles/14583967053069 (2024-06-04)
21. https://support.khanacademy.org/hc/en-us/articles/22396485532173 (2025-07-02)
22. https://support.khanacademy.org/hc/en-us/articles/202262994 (2026-02-03)
23. https://blog.khanacademy.org/new-ai-tools-bring-interactive-diagrams-and-targeted-practice-thanks-to-khan-academys-partnership-with-google-org/ (2026-08-27)
24. https://edworkingpapers.com/ai26-1551 (Oreopoulos & Low, Aug 2026)
25. https://www.chalkbeat.org/2026/08/25/ai-tutoring-students-khanmigo-khan-academy-engagement-study/ (2026-08-25)
26. https://www.chalkbeat.org/2026/04/09/sal-khan-reflects-on-ai-in-schools-and-khanmigo/ (2026-04-09)
27. https://help.openai.com/en/articles/11780217 (page: updated last month)
28. https://help.openai.com/en/articles/12315553 (page: updated 13 days ago)
29. https://help.openai.com/en/articles/20001274 (page: updated 3 days ago)
30. https://chatgpt.com/pricing (undated)
31. https://openai.com/policies/terms-of-use/ (effective 2026-01-01)
32. https://blog.google/products-and-platforms/products/education/guided-learning/ (2025-08-06)
33. https://support.google.com/gemini/answer/16448384 (undated)
34. https://support.google.com/gemini/answer/16109150 (undated)
35. https://gemini.google/subscriptions/ (undated)
36. https://support.google.com/gemini/answer/13594961 (2026-09-24)
37. https://techcrunch.com/2025/05/02/google-will-soon-start-letting-kids-under-13-use-its-gemini-chatbot (2025-05-02)
38. https://blog.google/innovation-and-ai/products/gemini-notebook/new-study-tools-september-2026/ (2026-09-15)
39. https://blog.google/feed/notebooklm-is-now-available-to-younger-users/ (2025-08-04)
40. https://www.synthesis.com/tutor (undated)
41. https://www.synthesis.com/coppa (2026-06-10)
42. https://sagetutor.app/ (undated)
43. https://sagetutor.app/privacy (2026-03-18)
44. https://www.mytutorbook.com/?for=homeschool (undated)
45. https://www.mytutorbook.com/pricing (undated)
46. https://www.mytutorbook.com/privacy (March 2026)
47. https://www.littlelit.ai/pricing (undated)
48. https://opened.co/blog/ai-tutors-homeschool (2026-01-09)
