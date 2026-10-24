# Graph Report - gsrc  (2026-10-24)

## Corpus Check
- 1 files · ~10,274 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 111 nodes · 257 edges · 10 communities
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- game.js
- submit
- endRound
- boot
- pickQuestions
- el
- startRound
- tagStats
- mk
- ac

## God Nodes (most connected - your core abstractions)
1. `submit()` - 20 edges
2. `el()` - 13 edges
3. `endRound()` - 13 edges
4. `pickQuestions()` - 11 edges
5. `startRound()` - 11 edges
6. `qid()` - 9 edges
7. `renderQ()` - 9 edges
8. `topicSheet()` - 8 edges
9. `whyCard()` - 8 edges
10. `boot()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `normState()` --indirect_call--> `qid()`  [INFERRED]
  game.js → game.js  _Bridges community 3 → community 4_
- `endRound()` --indirect_call--> `saveAll()`  [INFERRED]
  game.js → game.js  _Bridges community 3 → community 2_
- `submit()` --indirect_call--> `saveAll()`  [INFERRED]
  game.js → game.js  _Bridges community 3 → community 1_
- `endRound()` --indirect_call--> `buildFeel()`  [INFERRED]
  game.js → game.js  _Bridges community 2 → community 7_
- `endRound()` --indirect_call--> `buildReport()`  [INFERRED]
  game.js → game.js  _Bridges community 2 → community 5_

## Import Cycles
- None detected.

## Communities (10 total, 0 thin omitted)

### Community 0 - "game.js"
Cohesion: 0.07
Nodes (26): A4, A6, AITAGS, AL, BANK, bits, CHEERS, CONF (+18 more)

### Community 1 - "submit"
Cohesion: 0.16
Nodes (16): bumpHud(), deaccent(), drawCombo(), flashOK(), floatXP(), fullOf(), inRound(), judge() (+8 more)

### Community 2 - "endRound"
Cohesion: 0.22
Nodes (11): buildSayList(), burst(), buzz(), endRound(), lockFeel(), myRate(), rain(), ruleSplit() (+3 more)

### Community 3 - "boot"
Cohesion: 0.31
Nodes (10): boot(), drawMap(), hud(), loadLocal(), mergeStates(), normState(), pushDb(), saveAll() (+2 more)

### Community 4 - "pickQuestions"
Cohesion: 0.42
Nodes (10): drawFrom(), hasContent(), live(), outstanding(), pickQuestions(), qid(), retired(), seenN() (+2 more)

### Community 5 - "el"
Cohesion: 0.42
Nodes (9): askCoach(), bossCard(), buildReport(), closeSheet(), el(), nearMissPrompt(), sheet(), topicSheet() (+1 more)

### Community 6 - "startRound"
Cohesion: 0.39
Nodes (8): aiEsc(), aiPrompt(), aiRound(), aiRows(), freshenRound(), launchRound(), startRound(), weakTag()

### Community 7 - "tagStats"
Cohesion: 0.29
Nodes (6): accordHTML(), buildFeel(), copyProgress(), paintFeel(), progressText(), tagStats()

### Community 8 - "mk"
Cohesion: 0.29
Nodes (7): build(), choice(), en2fr(), fix(), fr2en(), mk(), typed()

### Community 9 - "ac"
Cohesion: 0.67
Nodes (3): ac(), sweep(), tone()

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `renderQ()` connect `submit` to `game.js`, `pickQuestions`, `el`, `startRound`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `endRound()` (e.g. with `buildFeel()` and `buildReport()`) actually correct?**
  _`endRound()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Should `game.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._
- **Why does `submit()` connect `submit` to `game.js`, `endRound`, `boot`, `pickQuestions`, `el`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `copyProgress()` connect `tagStats` to `game.js`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._