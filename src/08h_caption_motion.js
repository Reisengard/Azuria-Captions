/* ============================================================
   JIZURA — caption motion budgets and continuity (Gate 2.4)
   ============================================================ */
(() => {
'use strict';

const DEFAULT_BUDGET = Object.freeze({
  maxIntensity: 2,
  maxMotionCost: 0.9,
  maxAttentionCost: 0.85,
  primaryAttentionMin: 0.3,
  subtleSecondaryMax: 0.25,
  rollingWindow: 3,
  maxRollingAttention: 1.45,
  heroAttentionMin: 0.65,
  recentHistorySize: 4,
  repetitionPenalty: 0.16,
  maxContinuityChanges: 2,
  continuity: Object.freeze({
    font: 'fixed', alignment: 'fixed', position: 'fixed',
    treatment: 'flexible', accentColor: 'fixed', animationFamily: 'sticky',
  }),
});
const POLICIES = new Set(['fixed', 'sticky', 'flexible']);
const round = value => +value.toFixed(3);

J.captionMotionBudgetDefaults = DEFAULT_BUDGET;
J.captionMotionBudget = profile => {
  const source = profile && (profile.motionBudget || profile.budget || profile);
  const budget = Object.assign({}, DEFAULT_BUDGET, source || {});
  budget.continuity = Object.assign({}, DEFAULT_BUDGET.continuity, source && source.continuity || {});
  return budget;
};

const componentMetadata = component => {
  if (!component) return null;
  if (component.metadata) return component.metadata;
  if (component.capabilities) return component.capabilities;
  const group = component.group || component.category, id = component.id || component.key;
  const def = group && id && J.registry && J.registry(group)[id];
  return def && def.capabilities || null;
};
const componentId = component => `${component.group || component.category || 'component'}.${component.id || component.key || 'unknown'}`;
const plansFrom = context => Array.isArray(context.recentPlans) ? context.recentPlans : [];
const planTotals = plan => {
  const components = Array.isArray(plan.components) ? plan.components : [];
  let intensity = 0, motionCost = 0, attentionCost = 0;
  const resolved = [], unknown = [];
  for (const component of components) {
    const metadata = componentMetadata(component);
    if (!metadata) { unknown.push(componentId(component)); continue; }
    intensity = Math.max(intensity, Number(metadata.intensity) || 0);
    motionCost += Number(metadata.motionCost) || 0;
    attentionCost += Number(metadata.attentionCost) || 0;
    resolved.push({ component, metadata, id: componentId(component) });
  }
  return { intensity, motionCost: round(motionCost), attentionCost: round(attentionCost), resolved, unknown };
};

const previousTotals = plan => {
  if (plan && plan.motionSummary && Number.isFinite(plan.motionSummary.attentionCost)) return plan.motionSummary;
  return planTotals(plan || {});
};

const continuityCheck = (plan, previous, budget) => {
  const changes = [], violations = [], fields = budget.continuity || {};
  if (!previous) return { changes, violations };
  for (const [field, policy] of Object.entries(fields)) {
    if (!POLICIES.has(policy) || policy === 'flexible') continue;
    const before = previous[field], after = plan[field];
    if (before == null || after == null || before === after) continue;
    changes.push({ field, from: before, to: after, policy });
    if (policy === 'fixed') violations.push(`continuity-${field}`);
  }
  const controlledChanges = Object.keys(fields).filter(field => previous[field] != null && plan[field] != null && previous[field] !== plan[field]);
  if (controlledChanges.length > budget.maxContinuityChanges) violations.push('too-many-continuity-changes');
  return { changes, controlledChanges, violations };
};

J.evaluateCaptionMotionPlan = (plan, context = {}) => {
  const budget = J.captionMotionBudget(context.profile || context.budget);
  const totals = planTotals(plan || {}), reasons = [], warnings = [];
  if (totals.unknown.length) reasons.push('component-metadata-missing');
  if (totals.intensity > budget.maxIntensity) reasons.push('intensity-budget-exceeded');
  if (totals.motionCost > budget.maxMotionCost) reasons.push('motion-budget-exceeded');
  if (totals.attentionCost > budget.maxAttentionCost) reasons.push('attention-budget-exceeded');

  // A subtle exit ends the caption; it is not another simultaneous accent.
  // Its intensity, motion, and attention costs still count toward every budget.
  const attentionComponents = totals.resolved.filter(item => item.metadata.attentionCost > 0 &&
    !(item.component.group === 'exit' && item.metadata.attentionCost <= budget.subtleSecondaryMax));
  const primaries = attentionComponents.filter(item => item.component.role === 'primary' || item.metadata.attentionCost >= budget.primaryAttentionMin);
  const secondaries = attentionComponents.filter(item => !primaries.includes(item));
  if (primaries.length > 1) reasons.push('multiple-primary-techniques');
  if (secondaries.length > 1) reasons.push('multiple-secondary-techniques');
  if (secondaries.some(item => item.metadata.attentionCost > budget.subtleSecondaryMax)) reasons.push('secondary-not-subtle');

  const recentCount = Math.max(0, budget.rollingWindow - 1);
  const recent = recentCount ? plansFrom(context).slice(-recentCount) : [];
  const recentAttention = recent.reduce((sum, item) => sum + (Number(previousTotals(item).attentionCost) || 0), 0);
  const rollingAttention = round(recentAttention + totals.attentionCost);
  if (rollingAttention > budget.maxRollingAttention) reasons.push('rolling-attention-budget-exceeded');
  const hero = totals.attentionCost >= budget.heroAttentionMin || totals.intensity >= 3;
  const previous = recent[recent.length - 1] || context.previousPlan || null;
  const previousSummary = previous && previousTotals(previous);
  const previousHero = !!(previous && (previous.hero === true || previousSummary.attentionCost >= budget.heroAttentionMin || previousSummary.intensity >= 3));
  if (hero && previousHero) reasons.push('adjacent-hero-moment');

  const history = plansFrom(context).slice(-budget.recentHistorySize);
  const recentIds = history.flatMap(item => (item.components || []).map(componentId));
  const repeatedTechniques = totals.resolved.map(item => item.id).filter(id => recentIds.includes(id));
  const repetitionCost = round(repeatedTechniques.length * budget.repetitionPenalty);
  if (repeatedTechniques.length) warnings.push('recent-technique-repetition');

  // An explicit previousPlan (even undefined) is the caller's per-track predecessor; only fall back to the global one when absent.
  const continuity = continuityCheck(plan || {}, Object.prototype.hasOwnProperty.call(context, 'previousPlan') ? context.previousPlan : previous, budget);
  reasons.push(...continuity.violations);
  const uniqueReasons = Array.from(new Set(reasons));
  const manualOverride = context.manualOverride === true || plan.manualOverride === true;
  const hardReasons = uniqueReasons.filter(reason => reason === 'component-metadata-missing');
  if (manualOverride && uniqueReasons.length && !hardReasons.length) warnings.push('manual-override-exceeds-budget');
  if (manualOverride && hardReasons.length) warnings.push('manual-override-safety-blocked');
  const allowed = uniqueReasons.length === 0 || (manualOverride && hardReasons.length === 0);
  const score = round(Math.max(0, 100 - totals.motionCost * 18 - totals.attentionCost * 24 - repetitionCost * 100 - continuity.changes.length * 4));
  return {
    allowed, withinBudget: uniqueReasons.length === 0, score, reasons: uniqueReasons, warnings: Array.from(new Set(warnings)),
    totals: { intensity: totals.intensity, motionCost: totals.motionCost, attentionCost: totals.attentionCost, rollingAttention },
    composition: { primaryCount: primaries.length, secondaryCount: secondaries.length },
    hero, repeatedTechniques, repetitionCost, continuity,
  };
};

J.filterCaptionMotionCandidates = (plans, context = {}) => {
  const accepted = [], rejected = [];
  for (const plan of plans || []) {
    const motion = J.evaluateCaptionMotionPlan(plan, context);
    (motion.allowed ? accepted : rejected).push({ plan, motion });
  }
  accepted.sort((a, b) => b.motion.score - a.motion.score);
  return { accepted, rejected };
};

J.captionMotionSummary = (plan, context = {}) => {
  const result = J.evaluateCaptionMotionPlan(plan, context);
  return Object.assign({}, result.totals, { hero: result.hero });
};
})();
