'use client';

import dynamic from 'next/dynamic';

// The UI is a client-side app (react-router handles in-app navigation, auth lives in localStorage),
// so it is mounted without server rendering. Next.js serves it for every non-API path.
const App = dynamic(() => import('../../client/App'), { ssr: false });

export default function Page() {
  return <App />;
}
