// Passi di post-build comuni a produzione e prova.
//
// Sta in Node e non in una riga di shell dentro package.json perché lo script
// originale (`cp` + `for d in …`) gira solo in sh: su Windows npm lancia gli
// script con cmd.exe e la build si rompe con "d non atteso". Qui funziona
// uguale ovunque, e ci sta il punto delicato: quale dominio finisce nel CNAME.

import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'

// Le route pre-renderizzate: GitHub Pages serve file statici, senza una
// index.html in ogni cartella un accesso diretto a /it darebbe 404.
const ROUTE = ['it', 'en', 'coming-soon', 'slash-experiment']

// Un solo sorgente, due destinazioni: il dominio lo decide il flag.
const prova = process.argv.includes('--test')
const dominio = prova ? 'test.uranio.beer' : 'www.uranio.beer'

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('postbuild: manca dist/index.html, la build di vite non è andata')
  process.exit(1)
}

// Fallback di GitHub Pages per qualsiasi percorso non previsto: serve la SPA
// invece della pagina 404 di GitHub.
cpSync(join(DIST, 'index.html'), join(DIST, '404.html'))

for (const r of ROUTE) {
  mkdirSync(join(DIST, r), { recursive: true })
  cpSync(join(DIST, 'index.html'), join(DIST, r, 'index.html'))
}

writeFileSync(join(DIST, 'CNAME'), `${dominio}\n`)

// Il sito di prova non deve finire su Google: sarebbe contenuto duplicato del
// sito vero e ci si arriverebbe per sbaglio da una ricerca.
if (prova) {
  writeFileSync(join(DIST, 'robots.txt'), 'User-agent: *\nDisallow: /\n')
}

// Tutto quello che sta in public/ viene pubblicato: i PDF degli ordini sono
// documenti personali finiti lì per sbaglio, fuori dal sito in ogni caso.
const privati = readdirSync(DIST).filter((f) => /^ordine-.*\.pdf$/i.test(f))
for (const f of privati) {
  rmSync(join(DIST, f))
  console.log(`postbuild: escluso dal sito ${f}`)
}

console.log(`postbuild: dist pronta per ${dominio}${prova ? ' (noindex)' : ''}`)
