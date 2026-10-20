import type {components} from '../../../types/api/v1';
import type {ActivityManualRecommendation, ActivityRecommendationDraftRow, ActivityRecommendationRelationship,
    ActivityRecommendationRow} from '../../../types/FrontendActivityRecommendationTypes';
import type {PilotPlainMessageKey} from '../../../types/FrontendPilotUiTypes';

type Workspace = components['schemas']['ActivityRecommendations'];
type Row = ActivityRecommendationRow;
type Input = components['schemas']['ActivityRecommendationReview']['recommendations'][number];

/** Expected local selection failures retain catalog-owned native feedback. */
export class RecommendationDraftError extends Error {
    constructor(readonly messageKey: PilotPlainMessageKey) { super(messageKey); }
}

/** The same complete serializer feeds preview and apply. Rejected manual rows
 * are canceled intentions; generated rejection rows retain server rejection memory. */
export function recommendationReview(rows: ActivityRecommendationDraftRow[]): components['schemas']['ActivityRecommendationReview'] {
    const recommendations: Input[] = [];
    // Keep provenance and move sources alongside status; reducing this to a
    // participant/slot pair would turn a move or unassignment into an assignment.
    for (const {value} of rows) {
        if (value.manual && value.status === 'REJECTED') continue;
        recommendations.push({...(value.id ? {id: value.id} : {}), itemId: value.item.id, profileId: value.profile.id,
            status: value.status, operation: value.operation, sourceItemId: value.sourceItem?.id ?? null, manual: value.manual});
    }
    return {recommendations};
}

/** Stable machine identity protects a pending choice through harmless label and
 * locale refreshes. Status remains separate because it is the review's editable value. */
export function recommendationIdentity(row: Row): string {
    return JSON.stringify([row.id ?? null, row.item.id, row.profile.id, row.operation, row.sourceItem?.id ?? null, row.manual]);
}

/** Match one saved or newly persisted operation without depending on its label,
 * array position or the local DOM key assigned by a prior render. */
function sameRecommendationOperation(left: Row, right: Row): boolean {
    return (!left.id || !right.id || left.id === right.id) && left.item.id === right.item.id
        && left.profile.id === right.profile.id && left.operation === right.operation
        && (left.sourceItem?.id ?? null) === (right.sourceItem?.id ?? null) && left.manual === right.manual;
}

/** Reciprocal slot endpoints are eligibility evidence, never sufficient evidence
 * that two of several moves were authored as the same swap. */
function reciprocal(left: ActivityRecommendationDraftRow, right: ActivityRecommendationDraftRow): boolean {
    return left !== right && left.value.manual && right.value.manual && left.value.operation === 'REASSIGN'
        && right.value.operation === 'REASSIGN' && !!left.value.sourceItem && !!right.value.sourceItem
        && left.value.item.id === right.value.sourceItem.id && left.value.sourceItem.id === right.value.item.id;
}

/** Only unresolved restored moves can become another restored move's counterpart.
 * Explicit single moves and legs already belonging to another local swap stay independent. */
function counterpartCandidates(rows: ActivityRecommendationDraftRow[], row: ActivityRecommendationDraftRow): ActivityRecommendationDraftRow[] {
    return rows.filter(candidate => candidate.swapGroup === undefined && reciprocal(row, candidate));
}

/** Resolve the same relationship for labels, status changes and removal. Known
 * local groups win; restored data preserves one-step behavior only for a mutually
 * unique reciprocal pair. Larger reciprocal sets require deliberate user choice. */
export function recommendationRelationship(rows: ActivityRecommendationDraftRow[], row: ActivityRecommendationDraftRow): ActivityRecommendationRelationship {
    const single: ActivityRecommendationRelationship = {kind: 'single', partners: [row], candidates: []};
    if (!row.value.manual || row.value.operation !== 'REASSIGN' || !row.value.sourceItem || row.swapGroup === null) return single;

    // A local group is exact identity, not a search for the first reverse move.
    if (row.swapGroup !== undefined) {
        const grouped = rows.filter(candidate => candidate.swapGroup === row.swapGroup);
        return grouped.length === 2 && grouped.every(candidate => candidate === row || reciprocal(row, candidate))
            ? {kind: 'paired', partners: grouped, candidates: []} : single;
    }

    // A lone reverse candidate can itself have multiple possible partners.
    // Both directions must be unique before preserving the old one-step action.
    const candidates = counterpartCandidates(rows, row);
    if (candidates.length === 1 && counterpartCandidates(rows, candidates[0]!).length === 1)
        return {kind: 'paired', partners: [row, candidates[0]!], candidates: []};
    return candidates.length ? {kind: 'ambiguous', partners: [row], candidates} : single;
}

/** Existing matching consumers obtain their legs from the sole relationship owner. */
export function recommendationPartners(rows: ActivityRecommendationDraftRow[], row: ActivityRecommendationDraftRow): ActivityRecommendationDraftRow[] {
    return recommendationRelationship(rows, row).partners;
}

/** Record an explicitly constructed or chosen swap in local draft metadata only.
 * Serialization above deliberately ignores this group and the local row keys. */
export function pairRecommendationRows(row: ActivityRecommendationDraftRow, partner: ActivityRecommendationDraftRow): boolean {
    if (!reciprocal(row, partner)) return false;
    // Keys are unique within this mounted review. The group survives fresh reads
    // through operation matching below, not through a server field or storage key.
    row.swapGroup = partner.swapGroup = 'swap:' + row.key;
    return true;
}

/** Reconcile fresh snapshots while retaining known local relationships and DOM
 * identity. Names/status alone do not change an operation; removed/replaced legs
 * become explicit singles rather than silently borrowing another reciprocal move. */
export function reconcileRecommendationRows(values: Row[], previous: ActivityRecommendationDraftRow[], nextKey: () => string): ActivityRecommendationDraftRow[] {
    const rows: ActivityRecommendationDraftRow[] = [];
    for (const value of values) {
        const known = previous.find(row => sameRecommendationOperation(row.value, value));
        rows.push({key: known?.key ?? nextKey(), value: {...value},
            ...(known?.swapGroup === undefined ? {} : {swapGroup: known.swapGroup})});
    }

    // Every group remains a complete, reciprocal pair in the new projection.
    // An orphan was known to belong to a different swap. Preserve that evidence
    // as an explicit single instead of adopting an unrelated reverse operation.
    for (const row of rows) {
        if (typeof row.swapGroup !== 'string') continue;
        const relationship = recommendationRelationship(rows, row);
        if (relationship.kind !== 'paired') row.swapGroup = null;
    }
    return rows;
}

/** Fresh authority can retire a saved leg even while dirty values are retained.
 * Break its local group without replacing the user's statuses or draft rows. */
export function revalidateRecommendationGroups(rows: ActivityRecommendationDraftRow[], values: Row[]): void {
    const retired = new Set<string>();
    // Match the actual saved operation, not merely an ID whose endpoints changed.
    for (const row of rows) {
        if (typeof row.swapGroup === 'string' && row.value.id
            && !values.some(value => sameRecommendationOperation(row.value, value))) retired.add(row.swapGroup);
    }
    // Both former legs remain independent; neither may borrow a different move.
    for (const row of rows) {
        if (typeof row.swapGroup === 'string' && retired.has(row.swapGroup)) row.swapGroup = null;
    }
}

/** Select actual source assignments in this plan. Named roles cannot be moved
 * by the recommendations workflow and never become modal options. */
export function rolelessRecommendationAssignments(workspace: Workspace, profileId?: string) {
    return workspace.existingAssignments.filter(assignment => (!profileId || assignment.profile.id === profileId)
        && assignment.roles.every(role => role === 'default'));
}

/** Build one manual operation, or both reciprocal swap legs, from the admitted
 * workspace. The server still rechecks eligibility and warnings before persistence. */
export function manualRecommendationRows(workspace: Workspace, rows: ActivityRecommendationDraftRow[], input: ActivityManualRecommendation): Row[] {
    const target = workspace.slots.find(slot => slot.id === input.targetSlotId);
    const participant = workspace.participantOptions.find(person => person.profileId === input.profileId);
    if (!target || !participant) throw new RecommendationDraftError('activity.recommendations.selectParticipant');
    // Match the native duplicate guard before constructing any new draft row.
    if (hasPlacement(target.id, input.profileId)) throw new RecommendationDraftError('activity.recommendations.duplicate');
    const result: Row[] = [makeRow(target, input.profileId, participant.label, participant.nameIsFallback)];
    if (input.operation === 'ASSIGN') return result;

    const source = rolelessRecommendationAssignments(workspace, input.profileId).find(assignment => assignment.item.id === input.sourceItemId
        && assignment.item.id !== target.id);
    if (!source) throw new RecommendationDraftError('activity.recommendations.selectSource');
    result[0]!.operation = 'REASSIGN';
    result[0]!.sourceItem = source.item;
    if (input.operation === 'REASSIGN') return result;

    // A swap's second leg is constructed before either leg is published. This
    // prevents a rejected second choice from leaving a half-swap in the draft.
    const outgoing = rolelessRecommendationAssignments(workspace).find(assignment => assignment.item.id === target.id
        && assignment.profile.id === input.swapProfileId);
    if (!outgoing || outgoing.profile.id === input.profileId || hasPlacement(source.item.id, outgoing.profile.id))
        throw new RecommendationDraftError('activity.recommendations.selectSwap');
    const second = makeRow(source.item, outgoing.profile.id, outgoing.profile.name);
    second.operation = 'REASSIGN';
    second.sourceItem = target;
    result.push(second);
    return result;

    /** Both proposed and committed placements participate in the native duplicate guard. */
    function hasPlacement(itemId: string, profileId: string): boolean {
        // Labels and operation kinds cannot make a duplicate placement eligible.
        return rows.some(row => row.value.item.id === itemId && row.value.profile?.id === profileId)
            || workspace.existingAssignments.some(assignment => assignment.item.id === itemId && assignment.profile.id === profileId);
    }

    function makeRow(item: Row['item'], id: string, name: string, nameIsFallback?: boolean): Row {
        return {item, profile: {id, name, ...(nameIsFallback === undefined ? {} : {nameIsFallback})},
            sourceItem: null, status: 'APPROVED', operation: 'ASSIGN', manual: true};
    }
}

/** Attach warnings only to the identical operation, including its move source.
 * A rejected row does not carry actionable warnings in the native review. */
export function recommendationWarnings(row: Row, warnings: Workspace['warnings']) {
    if (row.status === 'REJECTED') return [];
    return warnings.find(entry => entry.recommendation.itemId === row.item.id && entry.recommendation.profileId === row.profile?.id
        && (entry.recommendation.operation ?? 'ASSIGN') === row.operation
        && (entry.recommendation.sourceItemId ?? null) === (row.sourceItem?.id ?? null))?.warnings ?? [];
}
