// Vitest wrapper for test/rego.conformance.ts — see test/_runSuite.ts for why.
import {test} from 'vitest'
import {runSuite} from '../_runSuite.ts'

test('rego.conformance', () => runSuite(() => import('../rego.conformance.ts')))
