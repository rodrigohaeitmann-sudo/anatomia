/**
 * The cases of the reduction mammaplasty, one file per case written by the pipeline: a breast state with the
 * techniques its degree of ptosis calls for (docs/plano-mamoplastia-tecnicas.md, docs/plano-mamoplastia-g3-g4.md).
 * Ptosis II keeps the names without suffix; the others are suffixed (-p1, -p3, -g3, -g4).
 *  - plans: marking, pedicle and resection (scripts/hybrid/build_mammaplasty.py)
 *  - steps: the step-by-step sequences (scripts/hybrid/build_mammaplasty_steps.py)
 */
import plan2 from "@/data/mammaplasty.json";
import plan1 from "@/data/mammaplasty-p1.json";
import plan3 from "@/data/mammaplasty-p3.json";
import planG3 from "@/data/mammaplasty-g3.json";
import planG4 from "@/data/mammaplasty-g4.json";
import steps2 from "@/data/mammaplastySteps.json";
import steps1 from "@/data/mammaplastySteps-p1.json";
import steps3 from "@/data/mammaplastySteps-p3.json";
import stepsG3 from "@/data/mammaplastySteps-g3.json";
import stepsG4 from "@/data/mammaplastySteps-g4.json";

/** In order of the degree of ptosis and hypertrophy. */
export const planCaseIds = ["ptose-1", "ptose-2", "ptose-3", "g3", "g4"] as const;
export type PlanCaseId = (typeof planCaseIds)[number];
/** Suffix of the names of a case (structures, meshes, files). */
export const planCaseSuffix: Record<PlanCaseId, string> = { "ptose-1": "-p1", "ptose-2": "", "ptose-3": "-p3", g3: "-g3", g4: "-g4" };
/** Ptosis II first: the reference case (its dimensions were the ones accepted in review). */
export const planFiles: unknown[] = [plan2, plan1, plan3, planG3, planG4];
export const stepFiles: unknown[] = [steps2, steps1, steps3, stepsG3, stepsG4];
