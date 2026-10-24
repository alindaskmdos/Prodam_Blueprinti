// Фикстуры контракта (contract/fixtures). JSON-импорт TS типизирует строками (kind: string),
// поэтому статически сверить со схемой нельзя — приводим к типу схемы через fixture<T>().
import type { Schemas } from '../features/api';
import projectJson from '@contract/fixtures/project.json';
import treeJson from '@contract/fixtures/tree.json';
import methodViewMergeJson from '@contract/fixtures/method-view.merge.json';
import analysisMergeJson from '@contract/fixtures/analysis.merge.json';
import fixAppliedJson from '@contract/fixtures/fix.applied.json';
import fixRejectedJson from '@contract/fixtures/fix.rejected.json';
import testJunitJson from '@contract/fixtures/test.junit.json';
import runOkJson from '@contract/fixtures/run.ok.json';
import verifyGreenJson from '@contract/fixtures/verify.green.json';
import verifyRedJson from '@contract/fixtures/verify.red.json';
import errorConflictJson from '@contract/fixtures/error.conflict.json';
import fileOrderServiceJson from '@contract/fixtures/file.order-service.json';
import umlDemoJson from '@contract/fixtures/uml.demo.json';

function fixture<T>(json: unknown): T {
  return json as T;
}

export const fixtures = {
  project: fixture<Schemas['Project']>(projectJson),
  tree: fixture<Schemas['ProjectTree']>(treeJson),
  methodViewMerge: fixture<Schemas['MethodView']>(methodViewMergeJson),
  analysisMerge: fixture<Schemas['Analysis']>(analysisMergeJson),
  fixApplied: fixture<Schemas['FixResult']>(fixAppliedJson),
  fixRejected: fixture<Schemas['FixResult']>(fixRejectedJson),
  testJunit: fixture<Schemas['TestCase']>(testJunitJson),
  runOk: fixture<Schemas['RunResult']>(runOkJson),
  verifyGreen: fixture<Schemas['VerifyResult']>(verifyGreenJson),
  verifyRed: fixture<Schemas['VerifyResult']>(verifyRedJson),
  errorConflict: fixture<Schemas['Error']>(errorConflictJson),
  fileOrderService: fixture<Schemas['FileText']>(fileOrderServiceJson),
  umlDemo: fixture<Schemas['UmlDiagram']>(umlDemoJson),
};
