import { runDemo } from "../../src/commands.js";
import { runLeadbayPreview } from "../../src/leadbay/preview-deployment.js";
import { FakeMcpSession } from "./fake-mcp-session.js";

export async function runSyntheticDemo(outDir: string, runId = "demo-e2e") {
  let fake: FakeMcpSession | undefined;
  const result = await runDemo({
    caseDir: "fixtures/building-materials-distributor",
    outDir,
    dependencies: {
      runId: () => runId,
      mcpRunner: async (input) => {
        fake = new FakeMcpSession({
          readResult: {
            qualification_questions: input.state.qualification_questions,
            count: input.state.qualification_questions.length,
            ideal_buyer_profile: input.state.ideal_buyer_profile,
            targeting_prompt: input.state.targeting_prompt,
            is_admin: input.state.user.admin,
            region: input.state.region,
          },
        });
        return runLeadbayPreview({
          ...input,
          sessionFactory: async () => fake!,
          bannerTimeoutMs: 25,
        });
      },
    },
  });
  return { result, fake: fake! };
}
