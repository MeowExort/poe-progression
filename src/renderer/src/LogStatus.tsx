import type { SessionState } from '@shared/api'
import { formatClock, formatDateTime, formatSize } from './format'

/** Shows which file is being read and whether the game is actually writing to it. */
export function LogStatus({ log }: { log: SessionState['log'] }) {
  if (!log.path) return <p className="log-status bad">Путь к Client.txt не задан — укажи его в настройках.</p>
  if (!log.found) return <p className="log-status bad">Файл не найден: {log.path}</p>

  return (
    <div className="log-status">
      <p className="log-path">{log.path}</p>
      <p>
        {log.size != null && <>{formatSize(log.size)} · </>}
        {log.modifiedAt != null && <>изменён {formatDateTime(log.modifiedAt)} · </>}
        новых строк с запуска: {log.liveLines}
        {log.lastLineAt != null && <> · последняя в {formatClock(log.lastLineAt)}</>}
      </p>
      {log.liveLines === 0 && (
        <p className="bad">
          Игра пока ничего не дописала в этот файл. Если ты в игре и переходишь между зонами, а счётчик стоит на
          нуле — это не тот Client.txt: выбери нужный в настройках.
        </p>
      )}
    </div>
  )
}
