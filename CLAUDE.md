# uranio.beer — istruzioni per Claude Code

## Commit automatico a ogni prompt

**Alla fine di ogni prompt fai un commit**, senza aspettare che te lo chieda.
Serve ad avere uno storico granulare: un prompt = un commit, così ogni
modifica si può leggere, isolare e annullare con un `git revert`.

Regole:

- **Sempre, anche per modifiche minime** (un colore, un commento, un numero
  di taratura). Se il prompt non ha toccato file, non commettere nulla.
- **Un solo commit per prompt**, alla fine, con tutto il lavoro di quel giro.
- **Messaggio descrittivo**, in italiano, all'imperativo, che dica *cosa* è
  cambiato — non `autocommit` e non `wip`. Prefissi tipo `feat:`, `fix:`,
  `refactor:`, `chore:`, `perf:`, `style:`.
  Esempio: `feat(about): bottiglia Corona al posto della piramide`.
  Corpo su più righe quando serve spiegare il *perché* di una scelta.
- **Si resta su `main`**, nessun branch: è l'autorizzazione esplicita del
  proprietario del repo, vale per tutta la sessione e per quelle future.
- **Non fare `push`.** Le credenziali locali prendono 403 su `origin`: lo
  storico resta in locale e il push lo fa il proprietario del repo.
- **Non usare `--amend`** su commit già fatti: meglio un commit in più che
  riscrivere la storia, la granularità è il punto.
- Se il lavoro è rimasto a metà o rotto, commetti lo stesso e **dillo nel
  messaggio** (`wip(about): …` con la nota di cosa manca): meglio un punto
  di ripristino sporco che un buco nello storico.

### C'è già una rete di sicurezza

In `~/.claude/settings.json` è configurato un hook `Stop` che fa
`git add -A` + commit con messaggio `autocommit <timestamp>` alla fine di
ogni turno. È un paracadute, non il meccanismo principale: se committi tu
per primo con un messaggio sensato, l'hook trova l'albero pulito e non fa
nulla. I commit `autocommit …` nello storico sono quelli in cui il commit
esplicito è mancato.

## Note sul progetto

- Vite + React 19 + TypeScript, three.js via `@react-three/fiber` / `drei`.
- Prima di chiudere un giro che tocca il codice: `npx tsc -b` e `npx eslint src`.
- I commenti nel codice sono in italiano: mantieni la stessa lingua e la
  stessa densità (spiegano il *perché*, non il *cosa*).
- I modelli 3D stanno in `public/3d/`. Per verificarli non serve un browser:
  si caricano in Node con `GLTFLoader` e si esegue la logica vera del
  componente (bbox, scala, materiali) — vedi lo storico per gli script usati.
