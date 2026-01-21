import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../../release/rum.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const rum = {
  name: 'rum',
  setup,
} satisfies Extension
