import type { Fragment } from '@shared/plan'

/**
 * Russian wording of the route steps. The route itself comes from exile-leveling in English;
 * game names (areas, monsters, quests, items) stay as the English client shows them, the
 * words around them are translated here.
 *
 * A key is a route line with its comment removed and every `{fragment|args}` cut down to
 * `{fragment}`; hints carry the `#sub ` prefix. In the value `{0}`, `{1}`… stand for the
 * fragments of the line in their original order, so the Russian sentence is free to put
 * them elsewhere. A test checks that every line of the route has an entry.
 */
export const ROUTE_RU: Record<string, string> = {
  // ── Steps ──
  '➞ {enter}': '➞ {0}',
  '➞ {enter}, get {waypoint_get}': '➞ {0}, активируй {1}',
  '➞ {arena}': '➞ {0}',
  '➞ {arena}, kill {kill}': '➞ {0}, убей {1}',
  '➞ {arena}, Kill {kill}': '➞ {0}, убей {1}',
  '➞ {arena}, kill {kill} & {kill}': '➞ {0}, убей {1} и {2}',
  '➞ {arena}, kill {kill}, take {quest_text}': '➞ {0}, убей {1}, забери {2}',
  '➞ {arena}, activate {generic}': '➞ {0}, активируй {1}',
  '➞ {arena}, get {crafting}': '➞ {0}, возьми {1}',
  '{waypoint}': '{0}',
  '{logout}': '{0}',
  '{portal}': '{0}',
  '{ascend}': 'Пройди {0}',
  'Take {portal}': '{0}',
  'Place {portal} in the plaza': 'Поставь {0} на площади',
  'Find {area}, place {portal}': 'Найди {0}, поставь {1}',
  'Get {waypoint_get}': 'Активируй {0}',
  'Find {waypoint_get}': 'Найди {0}',
  'Get {crafting}': 'Возьми {0}',
  'Hand in {quest}': 'Сдай квест {0}',
  'Hand in {quest}, take {quest_text}': 'Сдай квест {0}, забери {1}',
  'Complete {trial}': 'Пройди {0}',
  'Before {waypoint}, complete {trial}': 'Не доходя до {0}, пройди {1}',
  'Complete {quest_text}': 'Пройди {0}',
  'Kill {kill}': 'Убей {0}',
  'Kill {kill} & {kill}': 'Убей {0} и {1}',
  'Kill {kill}, take {quest_text}': 'Убей {0}, забери {1}',
  'Find and kill {kill}': 'Найди и убей {0}',
  'Find and kill {kill}, take {quest_text}': 'Найди и убей {0}, забери {1}',
  'Find and Kill {kill}, take {quest_text}': 'Найди и убей {0}, забери {1}',
  'Help {kill}, take {quest_text}': 'Помоги {0}, забери {1}',
  'Find and help {kill}, take {quest_text}': 'Найди {0} и помоги, забери {1}',
  'Talk to {generic}': 'Поговори с {0}',
  'Help and talk to {generic}': 'Помоги {0} и поговори',
  'Talk to {generic}, take {quest_text}': 'Поговори с {0}, забери {1}',
  'Talk to {generic}, kill {kill}': 'Поговори с {0}, убей {1}',
  'Talk to {generic} ➞ {enter}': 'Поговори с {0} ➞ {1}',
  'Talk to {generic} ➞ {arena}, kill {kill}': 'Поговори с {0} ➞ {1}, убей {2}',
  'Talk to {generic}, sail to {enter}': 'Поговори с {0}, плыви в {1}',
  'Talk to {generic}, Sail to Wraeclast': 'Поговори с {0}, плыви в Wraeclast',
  'Talk to {generic}, Set Sail from Oriath': 'Поговори с {0}, отплыви из Oriath',
  'Take {quest_text}': 'Забери {0}',
  'Take {quest_text}, activate {quest_text}': 'Забери {0}, активируй {1}',
  'Take the {generic} ➞ {enter}': 'Сядь в {0} ➞ {1}',
  'Find and take {quest_text}': 'Найди и забери {0}',
  'Find and take 7x{quest_text}': 'Найди и забери 7× {0}',
  'Find 1x{quest_text}': 'Найди 1× {0}',
  'Find 2x{quest_text}': 'Найди 2× {0}',
  'Find 3x{quest_text}': 'Найди 3× {0}',
  'Find 4x{quest_text}': 'Найди 4× {0}',
  'Find 3x{quest_text}, search in the corners of the map': 'Найди 3× {0} — ищи в углах карты',
  'Find {quest_text}, take {quest_text}': 'Найди {0}, забери {1}',
  'Find {generic}': 'Найди {0}',
  'Find {generic} to next floor': 'Найди {0} — спуск на следующий этаж',
  'Find {generic} ➞ {enter}': 'Найди {0} ➞ {1}',
  'Open {generic} ➞ {enter}': 'Открой {0} ➞ {1}',
  'Select {generic}': 'Выбери {0}',
  'Poison the {quest_text} ➞ {enter}': 'Отрави {0} ➞ {1}',
  'Activate {quest_text} with {quest_text}': 'Активируй {0}, вставив {1}',
  'Activate {quest_text}, use {quest_text}': 'Активируй {0}, войди в {1}',
  'Break {quest_text}': 'Сломай {0}',
  'Burn the {quest_text}': 'Сожги {0}',
  'Free {quest_text}': 'Освободи {0}',
  'Light the {quest_text}, throw in {quest_text}': 'Зажги {0}, брось в огонь {1}',

  // ── Hints ──
  '#sub Go {dir}': 'Иди {0}',
  '#sub Search {dir}': 'Ищи {0}',
  '#sub Usually {dir}': 'Обычно {0}',
  '#sub {dir} or {dir}': '{0} или {1}',
  '#sub Search {dir} side': 'Ищи со стороны {0}',
  '#sub Follow {dir} wall': 'Иди вдоль стены {0}',
  '#sub Go {dir} as much as possible': 'Иди {0}, пока есть куда',
  '#sub Go {dir} find the plaza': 'Иди {0}, найди площадь',
  '#sub Go {dir} follow cart tracks': 'Иди {0} по рельсам вагонеток',
  '#sub Go {dir} follow the exits keeping {dir}': 'Иди {0}, из выходов выбирай те, что {1}',
  '#sub Go {dir} from {quest_text}': 'Иди {0} от {1}',
  '#sub Go {dir} look for petrified soldiers': 'Иди {0}, ищи окаменевших солдат',
  '#sub Go {dir} look for the torch touching the road': 'Иди {0}, ищи факел у самой дороги',
  '#sub Go {dir} until you find the cliff': 'Иди {0}, пока не упрёшься в обрыв',
  '#sub Go {dir} until you find the hanged Karui': 'Иди {0}, пока не найдёшь повешенного Karui',
  '#sub Go {dir} counter-clockwise spiral': 'Иди {0}, по спирали против часовой стрелки',
  '#sub Try go {dir}, if it\'s blocked go {dir}': 'Попробуй пройти {0}; если там тупик — иди {1}',
  '#sub If you find a ledge, turn around and go {dir}': 'Если упёрся в уступ — развернись и иди {0}',
  '#sub Loop around clockwise': 'Обходи по часовой стрелке',
  '#sub Loop around clockwise to go {dir}': 'Обходи по часовой стрелке, чтобы выйти {0}',
  '#sub Loop around counter-clockwise': 'Обходи против часовой стрелки',
  '#sub {dir} corner of area, normally by a house': 'Угол зоны {0}, обычно возле дома',
  '#sub Go right of the bridge': 'Иди справа от моста',
  '#sub Go down the ledge next to the road': 'Спустись с уступа рядом с дорогой',
  '#sub Go in same direction as {waypoint}': 'Иди в ту же сторону, где {0}',
  '#sub Follow the road': 'Иди по дороге',
  '#sub Follow the road {dir}': 'Иди по дороге {0}',
  '#sub Follow the road until it ends': 'Иди по дороге до конца',
  '#sub Follow the road until {waypoint}': 'Иди по дороге до {0}',
  '#sub Follow the road, look for the broken {waypoint}': 'Иди по дороге, ищи сломанный {0}',
  '#sub Follow the trail in the direction of the torch': 'Иди по тропе в сторону факела',
  '#sub Look for 2 pillars near {waypoint}, follow the trail': 'Найди 2 столба возле {0} и иди по тропе',
  '#sub Look for the torch touching the road': 'Ищи факел у самой дороги',
  '#sub Follow the water': 'Иди вдоль воды',
  '#sub Follow the shore': 'Иди вдоль берега',
  '#sub Follow Bridges': 'Иди по мостам',
  '#sub Follow Stairs': 'Иди по лестницам',
  '#sub Follow stairs that are going up': 'Иди по лестницам, ведущим вверх',
  '#sub Follow edges of the zone and cross bridges in the corners': 'Иди по краю зоны и переходи мосты в углах',
  '#sub Typically bridges spawn in the opposite diagonal corners': 'Обычно мосты стоят в противоположных по диагонали углах',
  '#sub Follow the dead guards by doorways': 'Выбирай проходы, у которых лежат мёртвые стражники',
  '#sub At the fork in the road with wagons, go the route with 1 wagon, not 2':
    'На развилке с повозками иди туда, где 1 повозка, а не 2',
  '#sub Black splashes of paint on ground points to the right direction to go':
    'Чёрные пятна краски на земле показывают верное направление',
  '#sub Search opposite direction of the encampment entrance': 'Ищи в стороне, противоположной входу в лагерь',
  '#sub Search opposite the entrance': 'Ищи напротив входа',
  '#sub Search the side of road opposite {waypoint}': 'Ищи по другую сторону дороги от {0}',
  '#sub Look around nearby': 'Осмотрись рядом',
  '#sub Look for a book icon': 'Ищи значок книги',
  '#sub Look for a candle in a narrow corridor': 'Ищи свечу в узком коридоре',
  '#sub Look for barricades': 'Ищи баррикады',
  '#sub Look for the large empty room': 'Ищи большую пустую комнату',
  '#sub Look for the long hallway': 'Ищи длинный коридор',
  '#sub Look for map icon, access with nearby switch': 'Ищи значок на карте, вход открывается рычагом рядом',
  '#sub Look for a sewer grate leading to {arena}, it is attached to the cart tracks':
    'Ищи канализационную решётку, ведущую в {0}, — она у рельсов вагонеток',
  '#sub Look for the hidden switch halfway to {generic} in the corner opposite the entrance to access {generic}':
    'На полпути к {0} ищи скрытый рычаг в углу напротив входа — он открывает {1}',
  '#sub Find the switch hidden behind {generic} to access {generic}': 'Найди рычаг, спрятанный за {0}, — он открывает {1}',
  '#sub Interact with the switch just before the zig-zagging walls, go to the opposite side to access {generic}':
    'Нажми рычаг прямо перед стенами зигзагом и перейди на противоположную сторону — там {0}',
  '#sub In the room with a central pit, look {dir} or {dir} for a side area containing a {generic}':
    'В комнате с ямой по центру ищи {0} или {1} боковую зону — в ней {2}',
  '#sub Find and kill the pack of monster on the island {dir} for a {generic}':
    'Найди и убей пачку монстров на острове {0} — с неё падает {1}',
  '#sub Little streams connect the 3 Rhoa nests': 'Три гнезда Rhoa соединены ручейками',
  '#sub Usually form a triangle, but will rarely form a line': 'Обычно они стоят треугольником, изредка — в линию',
  '#sub First floor exit will be in one of the 3 corners': 'Выход с первого этажа — в одном из 3 углов',
  '#sub Remaining floors will have the exit diagonally across from the entrance':
    'На остальных этажах выход — по диагонали от входа',
  '#sub S shape or L shape leads to exit': 'К выходу ведёт путь в форме S или L',
  '#sub Stairs spawn in one of the corners': 'Лестница появляется в одном из углов',
  '#sub High chance for {generic}': 'Внутри с высоким шансом {0}',
  '#sub Vendor {generic} + {generic} + Normal {generic}': 'Рецепт торговцу: {0} + {1} + обычные (белые) {2}',
  '#sub Vendor {generic} + {generic} + Movement Speed {generic}': 'Рецепт торговцу: {0} + {1} + {2} со скоростью передвижения',
  '#sub Put currency needed to buy skill gems in inventory': 'Положи в инвентарь валюту на покупку камней умений',
  '#sub Type {generic} in chat to confirm that you have all 23 passives from quests':
    'Набери {0} в чате и проверь, что получены все 23 очка пассивок за квесты',
  '#sub Type {generic} in chat to confirm that you have all 24 passives from quests':
    'Набери {0} в чате и проверь, что получены все 24 очка пассивок за квесты',
  '#sub Recommended Level: 4': 'Рекомендуемый уровень: 4',
  '#sub Recommended Level: 8': 'Рекомендуемый уровень: 8',
  '#sub Recommended Level: 12': 'Рекомендуемый уровень: 12',
  '#sub Recommended Level: 14-15': 'Рекомендуемый уровень: 14–15',
  '#sub Recommended Level: 16': 'Рекомендуемый уровень: 16',
  '#sub Recommended Level: 20-22': 'Рекомендуемый уровень: 20–22',
  '#sub Farm Level: 40-42': 'Покачайся здесь до уровня 40–42',
  '#sub Farm Level: 58-62': 'Покачайся здесь до уровня 58–62'
}

/** The dictionary key of a route line: no comment, fragments without their arguments. */
export function routeLineKey(line: string, hint: boolean): string {
  const text = line
    .replace(/\s+#.*$/, '')
    .replace(/\{(\w+)(\|[^}]*)?\}/g, '{$1}')
    .trim()
  return hint ? `#sub ${text}` : text
}

/**
 * Rewords a parsed line in Russian: the fragments stay, the text between them is taken from
 * the dictionary. A line the dictionary does not know is left as it is.
 */
export function translateParts(line: string, hint: boolean, parts: Fragment[]): Fragment[] {
  const template = ROUTE_RU[routeLineKey(line, hint)]
  if (template === undefined) return parts
  const fragments = parts.filter((part) => part.type !== 'text')
  const result: Fragment[] = []
  for (const piece of template.split(/(\{\d+\})/)) {
    if (!piece) continue
    const slot = /^\{(\d+)\}$/.exec(piece)
    if (!slot) result.push({ type: 'text', text: piece })
    else if (fragments[+slot[1]]) result.push(fragments[+slot[1]])
  }
  return result
}
