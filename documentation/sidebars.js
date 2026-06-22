/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'index',
    {
      type: 'category',
      label: 'Introduction',
      collapsible: false,
      items: ['getting-started', 'core-concepts'],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'configuration',
        'typed-bridge',
        'wire-protocol',
        'security',
        'use-cases',
        'debugging',
      ],
    },
    {
      type: 'category',
      label: 'Child Iframe SDK',
      items: [
        'child/index',
        'child/security',
        'child/events-and-requests',
        'child/plugins',
        'child/resize',
      ],
    },
    {
      type: 'category',
      label: 'Plugins',
      items: ['plugins/plugins', 'plugins/resize'],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsible: false,
      items: ['api-reference', 'error-codes'],
    },
    {
      type: 'category',
      label: 'Help',
      items: ['troubleshooting', 'faq'],
    },
  ],
};

export default sidebars;
