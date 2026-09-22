# uranio.beer

Sito di Uranio: Vite + React + three.js, pubblicato su GitHub Pages.

## I due siti

GitHub Pages serve **un solo dominio per repository**: per questo il sito di
prova sta su un repo separato, non su un branch diverso di questo.

| | dominio | repo | comando |
|---|---|---|---|
| produzione | `www.uranio.beer` | `s1ddharth-s1ngh/uranio.beer` | `npm run deploy` |
| prova | `test.uranio.beer` | `s1ddharth-s1ngh/uranio-test` | `npm run deploy:test` |

Il sorgente è uno solo, questo: cambia solo la destinazione. `npm run
deploy:test` builda, scrive `test.uranio.beer` nel `CNAME` al posto di
`www.uranio.beer`, aggiunge un `robots.txt` che vieta l'indicizzazione (la
prova non deve finire su Google come doppione del sito vero) e pubblica sul
branch `gh-pages` dell'altro repo. **`npm run deploy` non viene toccato**: la
produzione si pubblica come prima.

DNS (OVH): `www` e `test` sono due CNAME verso `s1ddharth-s1ngh.github.io.`

## Attenzione a `public/`

Tutto ciò che sta in `public/` finisce online. I PDF degli ordini che ogni
tanto atterrano lì sono documenti personali: `scripts/postbuild.mjs` li toglie
dalla build (`ordine-*.pdf`), ma il posto giusto è fuori dal progetto.

## Comandi

```
npm run dev          # dev server, esposto anche in rete locale
npm run build        # build di produzione
npm run build:test   # build del sito di prova (CNAME test + noindex)
npm run lint
```

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
