import type { Family } from './index';

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Flux',
    entries: [
      {
        title: 'Processus de commande en couloirs',
        caption: 'flow · style boxes, lanes : un couloir par équipe (group), routing orthogonal, boucle de relance',
        wide: true,
        spec: {
          title: 'De la commande à la livraison',
          subtitle: 'Qui fait quoi, équipe par équipe',
          layers: [
            {
              mark: 'flow',
              graph: {
                nodes: [
                  { id: 'commande', label: 'Commande passée', shape: 'start', group: 'Client' },
                  { id: 'verif', label: 'Vérifier', group: 'Ventes' },
                  { id: 'paiement', label: 'Payée ?', shape: 'decision', group: 'Finance' },
                  { id: 'relance', label: 'Relancer', group: 'Ventes' },
                  { id: 'expedition', label: 'Expédier', group: 'Logistique' },
                  { id: 'facture', label: 'Facturer', group: 'Finance' },
                  { id: 'recu', label: 'Colis livré', shape: 'end', group: 'Client' },
                ],
                edges: [
                  { from: 'commande', to: 'verif' },
                  { from: 'verif', to: 'paiement' },
                  { from: 'paiement', to: 'expedition', label: 'Oui' },
                  { from: 'paiement', to: 'relance', label: 'Non' },
                  { from: 'relance', to: 'paiement', label: 'Relance', dashed: true },
                  { from: 'paiement', to: 'facture' },
                  { from: 'expedition', to: 'recu' },
                  { from: 'facture', to: 'recu', label: 'Facture', dashed: true },
                ],
              },
              encode: {},
              style: { variant: 'boxes', direction: 'LR', rankGap: 44, lanes: true, laneOrder: ['Client', 'Ventes', 'Logistique', 'Finance'], routing: 'orthogonal' },
            },
          ],
        },
      },
      {
        title: 'Couloirs verticaux',
        caption: 'flow · lanes en direction TB : un couloir par acteur, en-têtes en haut, liens orthogonaux',
        spec: {
          title: 'Demande de congé',
          subtitle: 'Du dépôt à la confirmation',
          layers: [
            {
              mark: 'flow',
              graph: {
                nodes: [
                  { id: 'depot', label: 'Demande déposée', shape: 'start', group: 'Salarié' },
                  { id: 'accord', label: 'Accord ?', shape: 'decision', group: 'Manager' },
                  { id: 'dates', label: 'Modifier les dates', group: 'Salarié' },
                  { id: 'solde', label: 'Vérifier le solde', group: 'RH' },
                  { id: 'confirme', label: 'Congé confirmé', shape: 'end', group: 'Salarié' },
                  { id: 'planning', label: 'Planning à jour', shape: 'end', group: 'RH' },
                ],
                edges: [
                  { from: 'depot', to: 'accord' },
                  { from: 'accord', to: 'solde', label: 'Oui' },
                  { from: 'accord', to: 'dates', label: 'Non' },
                  { from: 'dates', to: 'accord', label: 'Nouvelles dates', dashed: true },
                  { from: 'solde', to: 'confirme' },
                  { from: 'solde', to: 'planning' },
                ],
              },
              encode: {},
              style: { variant: 'boxes', direction: 'TB', rankGap: 48, lanes: true, routing: 'orthogonal' },
            },
          ],
        },
      },
      {
        title: 'Routage orthogonal',
        caption: 'flow · routing orthogonal : segments droits à coins arrondis, ports écartés, boucle qui contourne les boîtes',
        wide: true,
        spec: {
          title: 'Traitement d’une alerte',
          subtitle: 'Les liens contournent les étapes',
          layers: [
            {
              mark: 'flow',
              graph: {
                nodes: [
                  { id: 'alerte', label: 'Alerte reçue', shape: 'start' },
                  { id: 'critique', label: 'Critique ?', shape: 'decision' },
                  { id: 'astreinte', label: 'Astreinte' },
                  { id: 'planifier', label: 'Planifier' },
                  { id: 'corriger', label: 'Corriger', shape: 'subprocess' },
                  { id: 'tester', label: 'Tester' },
                  { id: 'clore', label: 'Alerte close', shape: 'end' },
                ],
                edges: [
                  { from: 'alerte', to: 'critique' },
                  { from: 'critique', to: 'astreinte', label: 'Oui' },
                  { from: 'critique', to: 'planifier', label: 'Non' },
                  { from: 'astreinte', to: 'corriger' },
                  { from: 'planifier', to: 'corriger' },
                  { from: 'corriger', to: 'tester' },
                  { from: 'tester', to: 'corriger', label: 'Échec', dashed: true },
                  { from: 'tester', to: 'clore' },
                  { from: 'critique', to: 'clore', label: 'Faux positif', dashed: true },
                ],
              },
              encode: {},
              style: { variant: 'boxes', direction: 'LR', rankGap: 44, routing: 'orthogonal' },
            },
          ],
        },
      },
    ],
  },
];
