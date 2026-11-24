import 'i18next'
import type en from '../locales/en/common.json'

// English is the reference catalogue: a key missing from it is a type error.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof en
    }
  }
}
