# Mossread

A calm, ad-free reader for your own PDFs. It runs entirely in your browser:
your files are never uploaded, and there is no account and no tracking.

**Live:** https://mossread.vercel.app

Mossread is at an early stage. The app shell is live and the PDF viewer is
being built.

## Open source, made to be forked

Mossread is free and open source under the [MIT License](LICENSE).

You can fork it, change the reading screens, add your own reading modes and
host your own copy, for personal or commercial use, without asking. The only
condition is to keep the copyright and license notice with the code.

## Run it locally

```sh
npm install
npm run dev         # http://localhost:5173
npm run dev:phone   # also reachable from a phone on the same network
npm run build       # static output in dist/
```

The build is a plain static site, so any static host works.

## Translations

Every piece of interface text lives in `src/locales/<language>/common.json`.
English is the reference catalogue. To add a language, copy the `en` folder,
rename it (for example `de` or `pt-BR`) and translate the values. It is picked
up automatically and loaded only when someone uses it.

## Privacy

PDFs are opened and kept in your browser's own storage on your device. The
site's Content Security Policy blocks requests to any other server, so the
page has no way to send your files anywhere.

## License

[MIT](LICENSE)
