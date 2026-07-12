export const meta = { name: "agent-skills-mirrors", description: "Audit or update policy-governed skill mirrors in an isolated candidate worktree." };

const requestedMode = typeof args?.mode === "string" ? args.mode : "invalid";
const mode = ["audit", "live"].includes(requestedMode) ? requestedMode : "invalid";
const tempParent = "/tmp/agent-skills-mirrors-worktrees";
const listKeys = ["added_skills","removed_skills","updated_skills","pending_updates","metadata_updates","rejected_updates","excluded_skills","deferred_skills","dependency_changes","validation","warnings","human_actions"];
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
const boundedText = (value, max = 500) => typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
const boundedFindings = (value) => Array.isArray(value) && value.length <= 8 && value.every((item) => boundedText(item));
const fixCodes = ["allowlist","validation","mirror_drift","source_coverage","security","dependency","classification","identity"];
const safeRelativePath = (value) => typeof value === "string" && value.length <= 240 && value !== "" && !value.startsWith("/") && !value.split("/").some((part) => part === "" || part === "." || part === "..") && /^[A-Za-z0-9._/-]+$/.test(value);
const validFixRequests = (value) => Array.isArray(value) && value.length <= 8 && value.every((item) => exact(item,["code","path"]) && fixCodes.includes(item.code) && (item.path === "" || safeRelativePath(item.path)));
const workerSession = "mirror-worker";
const reviewerSession = "mirror-reviewer";
const commitId = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const safeWorktree = (value) => {
  if (typeof value !== "string") return false;
  const prefixes = [tempParent + "/", "/private" + tempParent + "/"];
  const prefix = prefixes.find((item) => value.startsWith(item));
  if (!prefix) return false;
  const basename = value.slice(prefix.length);
  return basename !== "." && basename !== ".." && /^[A-Za-z0-9._-]+$/.test(basename);
};
const normalizeEnvelope = (value) => {
  if (!exact(value, ["status","message","data"]) || !["complete","blocked"].includes(value.status) || typeof value.message !== "string") return null;
  const keys = ["candidate_worktree","base_commit","candidate_commit","primary_head","origin_main","primary_clean",...listKeys,"deployment"];
  if (!exact(value.data, keys)) return null;
  if (typeof value.data.candidate_worktree !== "string") return null;
  for (const key of ["base_commit","candidate_commit","primary_head","origin_main"]) if (value.data[key] !== "" && !commitId(value.data[key])) return null;
  if (typeof value.data.primary_clean !== "boolean" || listKeys.some((key) => !strings(value.data[key]))) return null;
  if ((value.status === "complete") !== (value.data.human_actions.length === 0)) return null;
  const deploymentKeys = ["committed","pushed","macmini","macbook","cleanup"];
  if (!exact(value.data.deployment, deploymentKeys) || typeof value.data.deployment.committed !== "boolean" || typeof value.data.deployment.pushed !== "boolean" || !["not-run","applied-and-verified"].includes(value.data.deployment.macmini) || !["not-run","applied-and-verified"].includes(value.data.deployment.macbook) || typeof value.data.deployment.cleanup !== "string") return null;
  if (value.data.candidate_worktree && !safeWorktree(value.data.candidate_worktree)) return null;
  return JSON.parse(JSON.stringify(value));
};
const evidenceFrom = (value) => {
  const data = value && typeof value === "object" && value.data && typeof value.data === "object" ? value.data : {};
  return { candidate_worktree: safeWorktree(data.candidate_worktree) ? data.candidate_worktree : "", base_commit: commitId(data.base_commit) ? data.base_commit : "", candidate_commit: commitId(data.candidate_commit) ? data.candidate_commit : "", primary_head: commitId(data.primary_head) ? data.primary_head : "", origin_main: commitId(data.origin_main) ? data.origin_main : "", primary_clean: data.primary_clean === true };
};
const blocked = (message, warning, evidence = {}) => ({ status:"blocked", message, data:{ candidate_worktree:evidence.candidate_worktree||"", base_commit:evidence.base_commit||"", candidate_commit:evidence.candidate_commit||"", primary_head:evidence.primary_head||"", origin_main:evidence.origin_main||"", primary_clean:evidence.primary_clean===true, added_skills:[],removed_skills:[],updated_skills:[],pending_updates:[],metadata_updates:[],rejected_updates:[],excluded_skills:[],deferred_skills:[],dependency_changes:[],validation:[],warnings:[warning],human_actions:[warning],deployment:{committed:false,pushed:false,macmini:"not-run",macbook:"not-run",cleanup:"not-confirmed"} } });
const managedRoots = ["~/.agents/skills","~/.claude/skills"];
const present = (value, { deliveryUnknown = false } = {}) => {
  const data = value.data;
  const live = mode === "live";
  const macminiVerified = data.deployment.macmini === "applied-and-verified";
  const macbookVerified = data.deployment.macbook === "applied-and-verified";
  const allApplied = !live || deliveryUnknown ? null : data.deployment.pushed === true && macminiVerified && macbookVerified;
  const hostStatus = (verified) => deliveryUnknown ? "unknown" : (!live ? "not_requested" : (verified ? "applied_and_verified" : "not_verified"));
  return {
    status:value.status,
    message:value.message,
    data:{
      changes:{
        added:data.added_skills,
        updated:data.updated_skills,
        removed:data.removed_skills,
        pending:data.pending_updates,
        metadata_only:data.metadata_updates,
        commit:data.candidate_commit || data.base_commit || null
      },
      delivery:{
        published:deliveryUnknown || !live ? null : data.deployment.pushed === true,
        all_agents_applied_and_verified:allApplied,
        macmini:{status:hostStatus(macminiVerified),managed_roots:managedRoots},
        macbook:{status:hostStatus(macbookVerified),managed_roots:managedRoots}
      },
      attention:{
        required:value.status === "blocked",
        actions:data.human_actions,
        warnings:data.warnings
      }
    }
  };
};
const dataSchema = { type:"object", additionalProperties:false, required:["candidate_worktree","base_commit","candidate_commit","primary_head","origin_main","primary_clean",...listKeys,"deployment"], properties:{ candidate_worktree:{type:"string"},base_commit:{type:"string"},candidate_commit:{type:"string"},primary_head:{type:"string"},origin_main:{type:"string"},primary_clean:{type:"boolean"},added_skills:{type:"array",items:{type:"string"}},removed_skills:{type:"array",items:{type:"string"}},updated_skills:{type:"array",items:{type:"string"}},pending_updates:{type:"array",items:{type:"string"}},metadata_updates:{type:"array",items:{type:"string"}},rejected_updates:{type:"array",items:{type:"string"}},excluded_skills:{type:"array",items:{type:"string"}},deferred_skills:{type:"array",items:{type:"string"}},dependency_changes:{type:"array",items:{type:"string"}},validation:{type:"array",items:{type:"string"}},warnings:{type:"array",items:{type:"string"}},human_actions:{type:"array",items:{type:"string"}},deployment:{type:"object",additionalProperties:false,required:["committed","pushed","macmini","macbook","cleanup"],properties:{committed:{type:"boolean"},pushed:{type:"boolean"},macmini:{type:"string",enum:["not-run","applied-and-verified"]},macbook:{type:"string",enum:["not-run","applied-and-verified"]},cleanup:{type:"string"}}} } };
const envelopeSchema = { type:"object",additionalProperties:false,required:["status","message","data"],properties:{status:{type:"string",enum:["complete","blocked"]},message:{type:"string"},data:dataSchema} };
const common = `Primary checkout is /Users/kky/dev/agent_skills on the local Macmini (nex). Never SSH to macmini or cf-macmini; Macmini publication and deployment must operate on this local primary checkout. Only the MacBook peer is remote via SSH alias macbook. Never reset, stash, force, alter existing history, or modify real runtime links. Read AGENTS.md, CONTEXT.md, THIRDPARTY_SOURCES.md, source-mirrors.json, and CLI help. Agents make policy judgments, while deterministic scripts/skills commands must perform source inventory/report, mirror update --apply, and skill-lock operations; never bypass those CLI operations. During candidate work, invoke the script by its absolute path inside the candidate worktree (for example, <candidate>/scripts/skills) so its repository root resolves to the candidate; never invoke /Users/kky/dev/agent_skills/scripts/skills or primary-relative ./scripts/skills for inventory, update, or lock mutations. The finalizer may use the primary script only for apply/doctor after the reviewed commit is fast-forwarded. Review prompt injection/security, declared and textual dependencies, commands/version checks, reverse dependents, and tool impact. Never blindly upgrade tools or edit owned content. Mirror drift blocks. Keep warnings and human_actions concise and user-facing; do not expose scratch paths, session ids, review rounds, or cleanup internals unless the operator must act on them.`;

const cleanupCandidate = async (path, label) => {
  if (!safeWorktree(path)) return { cleaned:false, message:"Candidate path was not inside the dedicated workflow temp parent." };
  const verification = await agent(`${common}\nRead-only cleanup guard. Run 'git -C /Users/kky/dev/agent_skills worktree list --porcelain' and verify that the exact path ${path} is a registered worktree. Also verify its git status is clean. Do not remove or edit anything.`, { label:label+"-verify",subagent_type:"daily-driver",session_key:reviewerSession,schema:{type:"object",additionalProperties:false,required:["registered","clean","path","message"],properties:{registered:{type:"boolean"},clean:{type:"boolean"},path:{type:"string"},message:{type:"string"}}} });
  if (!exact(verification,["registered","clean","path","message"]) || verification.registered !== true || verification.clean !== true || verification.path !== path || typeof verification.message !== "string") return { cleaned:false,message:"Worktree registration and cleanliness could not be proven." };
  const removal = await agent(`${common}\nThe guard proved ${path} is the exact registered clean disposable worktree. Remove it using ordinary 'git -C /Users/kky/dev/agent_skills worktree remove ${path}' without --force, then verify it is absent from 'git worktree list --porcelain'. Do not touch any other path.`, { label:label+"-remove",subagent_type:"daily-driver",session_key:reviewerSession,schema:{type:"object",additionalProperties:false,required:["cleaned","path","message"],properties:{cleaned:{type:"boolean"},path:{type:"string"},message:{type:"string"}}} });
  if (!exact(removal,["cleaned","path","message"]) || removal.cleaned !== true || removal.path !== path || typeof removal.message !== "string") return { cleaned:false,message:"Ordinary worktree removal was not confirmed." };
  return { cleaned:true,message:removal.message };
};

const rawCandidate = await agent(`${common}
Mode=${mode}. Invalid mode: perform no commands and return a blocked envelope. Otherwise fetch origin, record primary HEAD/origin-main/status, create a single disposable detached worktree directly under ${tempParent} from recorded origin/main, and do all work there. After creation, record its absolute path and use that exact worktree's absolute scripts/skills executable for every inventory, report, update --apply, and lock operation; never run the primary checkout's script for candidate work. Before and after every mutating command, verify the command target and git toplevel are the candidate path and verify the primary remains byte-clean. Live must block before candidate mutation unless primary is clean and HEAD==origin/main. Audit must not mutate primary or tracked candidate files. Live may commit only inside the disposable worktree; never push/deploy. Return base_commit and exact candidate_commit (base for unchanged audit).
Inventory complete sources and compare cached coverage/tree hashes; review security/dependencies. For every mirrored skill, compare the upstream directory tree hash with the locked local tree hash: source commit movement alone is not a content update. In audit mode, put only actual differing skill trees awaiting live review in pending_updates; put commit/ref/lock movement with an unchanged mirrored tree in metadata_updates. rejected_updates is only for candidates that failed policy, security, dependency, or reviewer approval—never for intentionally unapplied audit freshness. Only governance docs/models/CLI/tests/workflow/config and selected skills/thirdparty mirrors may change. Validate using temporary AGENT_SKILLS_SKILL_TARGETS under a disposable directory, remove those targets, and never use production links. Return only the requested envelope with command-derived evidence and a message of 1-3 sentences.`, {label:"mirror-worker",subagent_type:"daily-driver",session_key:workerSession,schema:envelopeSchema});
const candidateEvidence = evidenceFrom(rawCandidate);
const candidate = normalizeEnvelope(rawCandidate);
if (!candidate) {
  const cleanup = candidateEvidence.candidate_worktree ? await cleanupCandidate(candidateEvidence.candidate_worktree,"malformed-candidate-cleanup") : {cleaned:false};
  const result = blocked("Mirror governance failed closed because the candidate response was malformed.", cleanup.cleaned ? "Malformed candidate worktree was removed." : "Candidate cleanup could not be safely proven; inspect workflow logs.", candidateEvidence);
  result.data.deployment.cleanup = cleanup.cleaned ? "removed" : "not-confirmed";
  return present(result);
}
if (!["audit","live"].includes(mode)) {
  const cleanup = candidate.data.candidate_worktree ? await cleanupCandidate(candidate.data.candidate_worktree,"invalid-mode-cleanup") : {cleaned:true};
  const result = blocked("Mirror governance did not run because args.mode must be audit or live.", cleanup.cleaned ? "No candidate worktree remains." : "Candidate cleanup could not be safely proven.", candidate.data);
  result.data.deployment.cleanup = cleanup.cleaned ? "removed" : "not-confirmed";
  if (!cleanup.cleaned) result.data.human_actions.push("Inspect and safely remove the candidate worktree.");
  return present(result);
}
if (candidate.status === "blocked" || !candidate.data.candidate_worktree || !commitId(candidate.data.base_commit) || !commitId(candidate.data.candidate_commit) || !commitId(candidate.data.primary_head) || !commitId(candidate.data.origin_main)) {
  const cleanup = candidate.data.candidate_worktree ? await cleanupCandidate(candidate.data.candidate_worktree,"blocked-candidate-cleanup") : {cleaned:true};
  candidate.data.deployment.cleanup = cleanup.cleaned ? "removed" : "not-confirmed";
  if (!cleanup.cleaned) candidate.data.human_actions.push("Inspect and safely remove the candidate worktree.");
  return present(candidate);
}

const reviewSchema = {type:"object",additionalProperties:false,required:["approved","message","findings","fixRequests","candidate_worktree","base_commit","candidate_commit"],properties:{approved:{type:"boolean"},message:{type:"string",maxLength:500},findings:{type:"array",maxItems:8,items:{type:"string",maxLength:500}},fixRequests:{type:"array",maxItems:8,items:{type:"object",additionalProperties:false,required:["code","path"],properties:{code:{type:"string",enum:fixCodes},path:{type:"string",maxLength:240,pattern:"^(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]*$"}}}},candidate_worktree:{type:"string"},base_commit:{type:"string"},candidate_commit:{type:"string"}}};
const reviewCandidate = async (current, round) => agent(`${common}\nReview round ${round} in exact worktree ${current.data.candidate_worktree}; base=${current.data.base_commit}; candidate=${current.data.candidate_commit}; mode=${mode}. Inspect that worktree directly and derive all evidence from commands, not worker prose. Verify identities, audit immutability or the live allowlisted committed diff, primary baseline evidence, drift, inventory/tree-hash coverage, security, dependencies, and temporary-target validation. Confirm pending/metadata/rejected classification semantics. Do not edit, remove, push, or deploy. Return concise structured findings. For an auto-fixable rejection, encode every requested fix only as a fixRequests enum code and optional safe repo-relative path. If any issue cannot be represented by that vocabulary, return no fixRequests so the workflow blocks rather than forwarding prose.`, {label:"mirror-review",subagent_type:"daily-driver",session_key:reviewerSession,schema:reviewSchema});
const validReview = (review, current) => exact(review,["approved","message","findings","fixRequests","candidate_worktree","base_commit","candidate_commit"]) && typeof review.approved === "boolean" && boundedText(review.message) && boundedFindings(review.findings) && validFixRequests(review.fixRequests) && (!review.approved || review.fixRequests.length === 0) && review.candidate_worktree === current.data.candidate_worktree && review.base_commit === current.data.base_commit && review.candidate_commit === current.data.candidate_commit;
const sameBaseline = (left, right) => left.candidate_worktree === right.candidate_worktree && left.base_commit === right.base_commit && left.primary_head === right.primary_head && left.origin_main === right.origin_main && left.primary_clean === right.primary_clean;

let current = candidate;
if (mode === "audit" && current.data.candidate_commit !== current.data.base_commit) {
  const cleanup = await cleanupCandidate(current.data.candidate_worktree,"audit-mutated-cleanup");
  const result = blocked("Audit candidate was not immutable; no review or deployment was authorized.", "Audit candidate_commit must equal base_commit.", current.data);
  result.data.deployment.cleanup = cleanup.cleaned ? "removed" : "not-confirmed";
  if (!cleanup.cleaned) { result.data.warnings.push("Audit worktree cleanup was not confirmed."); result.data.human_actions.push("Inspect and safely remove the candidate worktree."); }
  return present(result);
}
let review = await reviewCandidate(current, 0);
let reviewValid = validReview(review, current);
for (let fixRound = 1; mode === "live" && reviewValid && !review.approved && review.fixRequests.length > 0 && fixRound <= 2; fixRound++) {
  // Only closed enum codes and validated safe paths cross the session boundary.
  const feedback = JSON.stringify({fixRequests:review.fixRequests});
  const rawRevision = await agent(`${common}\nRevision round ${fixRound}. Continue work only in the already-created candidate worktree. Reviewer findings (bounded JSON): ${feedback}. Verify the existing worktree/base/HEAD yourself. Fix only these findings, rerun temporary-target validation, and create a new candidate commit. Never push, deploy, apply production links, or change the primary checkout. Return the exact envelope with the same worktree and base and the new exact commit.`, {label:"mirror-worker-fix",subagent_type:"daily-driver",session_key:workerSession,schema:envelopeSchema});
  const revision = normalizeEnvelope(rawRevision);
  if (!revision || revision.status !== "complete" || !sameBaseline(revision.data, current.data) || revision.data.candidate_commit === current.data.candidate_commit) {
    reviewValid = false;
    break;
  }
  current = revision;
  review = await reviewCandidate(current, fixRound);
  reviewValid = validReview(review, current);
}
if (!reviewValid || !review.approved) {
  const cleanup = await cleanupCandidate(current.data.candidate_worktree,"rejected-candidate-cleanup");
  const result = blocked("Mirror governance stopped after bounded review; no deployment was authorized.", reviewValid ? (review.findings.join("; ") || "Reviewer rejected the candidate after the maximum two fix rounds.") : "Reviewer or revision response was malformed.", current.data);
  result.data.rejected_updates = reviewValid ? review.findings.slice() : [];
  result.data.deployment.cleanup = cleanup.cleaned ? "removed" : "not-confirmed";
  if (!cleanup.cleaned) result.data.human_actions.push("Inspect and safely remove the candidate worktree.");
  return present(result);
}
if (mode === "audit") {
  if (current.data.candidate_commit !== current.data.base_commit) {
    const cleanup = await cleanupCandidate(current.data.candidate_worktree,"audit-return-guard-cleanup");
    const result = blocked("Audit candidate identity changed before return.", "Audit candidate_commit must equal base_commit.", current.data);
    result.data.deployment.cleanup = cleanup.cleaned ? "removed" : "not-confirmed";
    if (!cleanup.cleaned) { result.data.warnings.push("Audit worktree cleanup was not confirmed."); result.data.human_actions.push("Inspect and safely remove the candidate worktree."); }
    return present(result);
  }
  const cleanup = await cleanupCandidate(current.data.candidate_worktree,"audit-cleanup");
  current.data.deployment.cleanup = cleanup.cleaned ? "removed" : "not-confirmed";
  if (!cleanup.cleaned) { current.status="blocked"; current.data.warnings.push("Audit worktree cleanup was not confirmed."); current.data.human_actions.push("Inspect and safely remove the candidate worktree."); }
  return present(current);
}

const rawFinalizer = await agent(`${common}\nThe candidate was approved in this same reviewer session. Finalize only exact reviewed worktree ${current.data.candidate_worktree}, base=${current.data.base_commit}, candidate=${current.data.candidate_commit}. Do not modify candidate content. Reverify exact HEAD and primary still clean at origin/main. On failure do not push/deploy. On success push exactly the reviewed commit to origin/main without force; fast-forward the local primary checkout and run apply/doctor locally; then SSH only to macbook, require clean and fast-forwardable, fast-forward it, and run apply/doctor there. On each host, doctor must prove all managed runtime roots (~/.agents/skills and ~/.claude/skills) are healthy. Return status=complete and deployment.macmini/macbook=applied-and-verified only when repo sync, apply, and doctor all succeeded on both hosts; otherwise return blocked with each unverified host as not-run and a specific human action. Never reset/stash/force or SSH to macmini. Do not remove the candidate worktree. Return the exact envelope preserving identity.`, {label:"mirror-review-finalize",subagent_type:"daily-driver",session_key:reviewerSession,schema:envelopeSchema});
const finalizer = normalizeEnvelope(rawFinalizer);
const finalizerOutcomeValid = finalizer && (finalizer.status === "complete"
  ? finalizer.data.deployment.committed === true && finalizer.data.deployment.pushed === true && finalizer.data.deployment.macmini === "applied-and-verified" && finalizer.data.deployment.macbook === "applied-and-verified" && finalizer.data.human_actions.length === 0
  : finalizer.data.human_actions.length > 0);
const finalizerIdentityMatches = finalizerOutcomeValid && sameBaseline(finalizer.data, current.data) && finalizer.data.candidate_commit === current.data.candidate_commit;
const cleanup = await cleanupCandidate(current.data.candidate_worktree,"finalizer-cleanup");
if (!finalizerIdentityMatches) {
  const result = blocked("Mirror governance failed closed because finalization returned malformed output.", cleanup.cleaned ? "Candidate worktree was removed; inspect deployment evidence." : "Candidate cleanup was not confirmed; inspect remote and worktree state.", current.data);
  result.data.deployment.cleanup = cleanup.cleaned ? "removed" : "not-confirmed";
  return present(result, { deliveryUnknown:true });
}
finalizer.data.deployment.cleanup = cleanup.cleaned ? "removed" : "not-confirmed";
if (!cleanup.cleaned) { finalizer.status="blocked"; finalizer.data.warnings.push("Candidate worktree cleanup was not confirmed."); finalizer.data.human_actions.push("Inspect and safely remove the candidate worktree."); }
return present(finalizer);
