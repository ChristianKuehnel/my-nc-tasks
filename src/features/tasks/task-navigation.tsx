import { createContext, useContext, useState, type ReactNode } from 'react';
import type { CalDAVCalendar, DavTask } from '@/services/caldav';
import type { AuthSession } from '@/services/nextcloud/types';

type Account = Pick<AuthSession, 'serverUrl' | 'loginName'>;

interface TaskNavigation {
  calendar: CalDAVCalendar | null;
  task: DavTask | null;
  revision: number;
  selectCalendar: (calendar: CalDAVCalendar, account: Account) => void;
  selectTask: (task: DavTask) => void;
  invalidateTasks: () => void;
}

const Context = createContext<(TaskNavigation & { account: Account | null }) | null>(null);

/** Keep DAV data out of route params and deep links. */
export function TaskNavigationProvider({ children }: { children: ReactNode }) {
  const [calendar, setCalendar] = useState<CalDAVCalendar | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [task, setTask] = useState<DavTask | null>(null);
  const [revision, setRevision] = useState(0);
  return (
    <Context.Provider
      value={{
        calendar,
        account,
        task,
        revision,
        selectCalendar: (value, { serverUrl, loginName }) => {
          setAccount({ serverUrl, loginName });
          setTask(null);
          setCalendar(value);
        },
        selectTask: setTask,
        invalidateTasks: () => setRevision((value) => value + 1),
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useTaskNavigation(account: Account | null) {
  const navigation = useContext(Context);
  if (!navigation || !account) return null;
  const matches =
    navigation.account?.serverUrl === account.serverUrl &&
    navigation.account.loginName === account.loginName;
  return matches ? navigation : { ...navigation, calendar: null, task: null };
}
