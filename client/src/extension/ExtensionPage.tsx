import type { PageProps } from '@into-cps-association/dtaas-sdk';
import Layout from 'page/Layout';
import PageShell from 'components/PageShell';

/** `HostServices.ui.Page`: the frame every core page sits in. */
function ExtensionPage({ title, description, children }: Readonly<PageProps>) {
  return (
    <Layout sx={{ display: 'flex' }}>
      <PageShell title={title} description={description}>
        {children}
      </PageShell>
    </Layout>
  );
}

export default ExtensionPage;
