/**
 * The cases of the reduction mammaplasty, one file per case written by the pipeline (docs/plano-mamoplastia-g3-g4.md):
 * ptosis II with moderate hypertrophy (the names without suffix) and the hypertrophies G3 and G4 (suffixed -g3, -g4).
 *  - plans: marking, pedicle and resection (scripts/hybrid/build_mammaplasty.py)
 *  - steps: the step-by-step sequences (scripts/hybrid/build_mammaplasty_steps.py)
 */
import plan2 from "@/data/mammaplasty.json";
import plan3 from "@/data/mammaplasty-g3.json";
import plan4 from "@/data/mammaplasty-g4.json";
import steps2 from "@/data/mammaplastySteps.json";
import steps3 from "@/data/mammaplastySteps-g3.json";
import steps4 from "@/data/mammaplastySteps-g4.json";

export const planCaseIds = ["ptose-2", "g3", "g4"] as const;
export type PlanCaseId = (typeof planCaseIds)[number];
export const planFiles: unknown[] = [plan2, plan3, plan4];
export const stepFiles: unknown[] = [steps2, steps3, steps4];
