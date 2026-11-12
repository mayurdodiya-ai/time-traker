/**
 * Where a card lands on screen the moment it is dropped on a list, BEFORE the server has answered. It mirrors the server's rule
 * (PATCH /tasks/:id with a stageId), so the optimistic move and the real result agree:
 *  - a Chronos-only card (no Trello card), or a drop onto a Chronos-only list: only its column changes (localStage); the Trello card stays put
 *  - a card that has a Trello card, dropped on a Trello list: it follows that list (and its card moves in Trello)
 * `target` = { id, name, local } describes the list that was dropped on.
 */
export function placeTask(task, target) {
  const hasCard = task.trello?.kind === 'card';
  if (task.chronosOnly || !hasCard || target.local) return { ...task, localStage: target.id, stage: target.name };
  return { ...task, localStage: null, stage: target.name, trello: { ...task.trello, idList: target.id } };
}
