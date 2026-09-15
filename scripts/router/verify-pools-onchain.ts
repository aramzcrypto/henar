/** Local CLI wrapper; the implementation lives in apps/router (uploaded to Vercel). */
import { verifyPoolsCli } from "../../apps/router/src/verify-pools-cli";

verifyPoolsCli().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
