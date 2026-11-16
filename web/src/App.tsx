import { PRODUCT_NAME } from './brand.js';
import { ConnectionIndicator } from './ConnectionIndicator.js';
import { QueueScreen } from './queue/QueueScreen.js';
import { paths, useRoute, type Route } from './route.js';
import { EmptyBlock } from './ui/states.js';

export function App() {
  const route = useRoute();
  return (
    <>
      <header className="app-header">
        <span className="app-name">{PRODUCT_NAME}</span>
        <nav className="app-nav" aria-label="Main">
          <a
            href={paths.queue()}
            aria-current={
              route.name === 'queue' || route.name === 'order'
                ? 'page'
                : undefined
            }
          >
            Queue
          </a>
          <a
            href={paths.paste()}
            aria-current={route.name === 'paste' ? 'page' : undefined}
          >
            Paste an email
          </a>
        </nav>
        <ConnectionIndicator />
      </header>
      <main className="app-main">
        <Screen route={route} />
      </main>
    </>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'queue':
      return <QueueScreen status={route.status} />;
    case 'order':
      return <EmptyBlock title="Order" />;
    case 'paste':
      return <EmptyBlock title="Paste an email" />;
    case 'not-found':
      return (
        <EmptyBlock title="Page not found">
          <p>
            <a href={paths.queue()}>Go to the queue</a>
          </p>
        </EmptyBlock>
      );
  }
}
