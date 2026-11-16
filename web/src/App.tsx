import { PRODUCT_NAME } from './brand.js';
import { ConnectionIndicator } from './ConnectionIndicator.js';
import { OrderScreen } from './order/OrderScreen.js';
import { PasteEmailScreen } from './paste/PasteEmailScreen.js';
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
      // The key makes a different order a fresh screen: no state carries over.
      return <OrderScreen key={route.id} id={route.id} />;
    case 'paste':
      return <PasteEmailScreen />;
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
