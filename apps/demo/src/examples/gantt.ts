import type { Family } from './index';

// Fixed dates (2026): an example never reads the clock, "today" is part of the spec.

/** A site redesign: owner, share done, predecessors (by task name). */
const redesign = [
  { tache: 'Cadrage', debut: '2026-03-02', fin: '2026-03-09', avancement: 1, responsable: 'Produit', apres: '' },
  { tache: 'Maquettes', debut: '2026-03-09', fin: '2026-03-20', avancement: 1, responsable: 'Design', apres: 'Cadrage' },
  { tache: 'Contenus', debut: '2026-03-12', fin: '2026-03-31', avancement: 0.55, responsable: 'Produit', apres: 'Cadrage' },
  { tache: 'API commandes', debut: '2026-03-16', fin: '2026-04-03', avancement: 0.4, responsable: 'Technique', apres: 'Cadrage' },
  { tache: 'Intégration', debut: '2026-03-23', fin: '2026-04-10', avancement: 0.15, responsable: 'Technique', apres: 'Maquettes' },
  { tache: 'Paiement', debut: '2026-04-06', fin: '2026-04-17', avancement: 0, responsable: 'Technique', apres: 'API commandes' },
  { tache: 'Recette', debut: '2026-04-14', fin: '2026-04-24', avancement: 0, responsable: 'Qualité', apres: 'Intégration, Paiement' },
  { tache: 'Mise en ligne', debut: '2026-04-28', fin: '2026-04-28', avancement: 0, responsable: 'Produit', apres: 'Recette' },
];

/** Opening a shop: three phases, each closed by a milestone. */
const shop = [
  { id: 'bail', tache: 'Signature du bail', phase: 'Préparation', debut: '2026-01-12', fin: '2026-01-30', avancement: 1, etat: 'Terminé', apres: '' },
  { id: 'plans', tache: 'Plans d’aménagement', phase: 'Préparation', debut: '2026-01-19', fin: '2026-02-13', avancement: 1, etat: 'Terminé', apres: '' },
  { id: 'permis', tache: 'Autorisation de travaux', phase: 'Préparation', debut: '2026-02-02', fin: '2026-02-27', avancement: 1, etat: 'Terminé', apres: 'plans' },
  { id: 'j1', tache: 'Feu vert travaux', phase: 'Préparation', debut: '2026-03-02', fin: '2026-03-02', avancement: 1, etat: 'Terminé', apres: 'permis, bail' },
  { id: 'gros', tache: 'Gros œuvre', phase: 'Travaux', debut: '2026-03-02', fin: '2026-03-27', avancement: 0.8, etat: 'En cours', apres: 'j1' },
  { id: 'elec', tache: 'Électricité et réseau', phase: 'Travaux', debut: '2026-03-16', fin: '2026-04-10', avancement: 0.35, etat: 'En cours', apres: '' },
  { id: 'mobilier', tache: 'Mobilier et enseigne', phase: 'Travaux', debut: '2026-04-06', fin: '2026-04-24', avancement: 0, etat: 'À venir', apres: 'gros' },
  { id: 'j2', tache: 'Réception du chantier', phase: 'Travaux', debut: '2026-04-27', fin: '2026-04-27', avancement: 0, etat: 'À venir', apres: 'mobilier, elec' },
  { id: 'recrut', tache: 'Recrutement', phase: 'Ouverture', debut: '2026-03-23', fin: '2026-04-30', avancement: 0.3, etat: 'En cours', apres: '' },
  { id: 'stock', tache: 'Mise en rayon', phase: 'Ouverture', debut: '2026-04-28', fin: '2026-05-12', avancement: 0, etat: 'À venir', apres: 'j2' },
  { id: 'formation', tache: 'Formation de l’équipe', phase: 'Ouverture', debut: '2026-05-04', fin: '2026-05-13', avancement: 0, etat: 'À venir', apres: 'recrut' },
  { id: 'j3', tache: 'Ouverture au public', phase: 'Ouverture', debut: '2026-05-16', fin: '2026-05-16', avancement: 0, etat: 'À venir', apres: 'stock, formation' },
];

const at = (h: number, min = 0) => `2026-03-18T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
const booking = (salle: string, titre: string, type: string, h0: number, m0: number, h1: number, m1: number) => ({ salle, titre, type, debut: at(h0, m0), fin: at(h1, m1) });

/** One day of meeting rooms; two rooms are booked twice at the same time. */
const rooms = [
  booking('Atlas', 'Comité de direction', 'Interne', 9, 0, 10, 30),
  booking('Atlas', 'Revue budgétaire', 'Interne', 11, 0, 12, 30),
  booking('Atlas', 'Démo client Novalys', 'Client', 14, 0, 15, 30),
  booking('Atlas', 'Point hebdo', 'Interne', 16, 0, 17, 0),
  booking('Boréal', 'Formation sécurité', 'Formation', 9, 0, 12, 0),
  booking('Boréal', 'Entretien', 'Recrutement', 10, 0, 11, 0),
  booking('Boréal', 'Atelier produit', 'Interne', 13, 30, 16, 0),
  booking('Cassiopée', 'Entretien', 'Recrutement', 9, 30, 10, 30),
  booking('Cassiopée', 'Entretien', 'Recrutement', 11, 0, 12, 0),
  booking('Cassiopée', 'Appel fournisseur', 'Client', 14, 30, 15, 15),
  booking('Cassiopée', 'Rétrospective', 'Interne', 16, 0, 17, 30),
  booking('Delta', 'Atelier Orsay', 'Client', 10, 0, 12, 30),
  booking('Delta', 'Prise en main des outils', 'Formation', 14, 0, 17, 0),
  booking('Delta', 'Visite de site', 'Client', 15, 0, 16, 30),
  booking('Écho', 'Stand-up', 'Interne', 9, 0, 9, 30),
  booking('Écho', 'Accueil des nouveaux', 'Formation', 10, 0, 11, 30),
  booking('Écho', 'Négociation Altis', 'Client', 15, 30, 17, 30),
];

/** Six weeks of assignments: someone on two projects at once gets two lanes. */
const staffing = [
  { personne: 'Camille', mission: 'Refonte du site', client: 'Novalys', debut: '2026-05-04', fin: '2026-05-29' },
  { personne: 'Camille', mission: 'Audit SEO', client: 'Altis', debut: '2026-05-25', fin: '2026-06-12' },
  { personne: 'Idriss', mission: 'Migration des données', client: 'Orsay', debut: '2026-05-04', fin: '2026-05-22' },
  { personne: 'Idriss', mission: 'Refonte du site', client: 'Novalys', debut: '2026-05-25', fin: '2026-06-12' },
  { personne: 'Jeanne', mission: 'Tableau de bord', client: 'Altis', debut: '2026-05-11', fin: '2026-06-05' },
  { personne: 'Louis', mission: 'Migration des données', client: 'Orsay', debut: '2026-05-04', fin: '2026-06-12' },
  { personne: 'Louis', mission: 'Support', client: 'Novalys', debut: '2026-05-18', fin: '2026-05-29' },
  { personne: 'Nadia', mission: 'Congés', client: 'Absence', debut: '2026-05-04', fin: '2026-05-15' },
  { personne: 'Nadia', mission: 'Tableau de bord', client: 'Altis', debut: '2026-05-18', fin: '2026-06-12' },
];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** One day of five machines: long runs, cut by setups, stops and maintenance. */
const machines = (() => {
  const r = rng(7);
  const out: { machine: string; etat: string; debut: number; fin: number }[] = [];
  const start = new Date(2026, 2, 18, 6, 0).getTime();
  const end = new Date(2026, 2, 18, 22, 0).getTime();
  for (const machine of ['Presse 1', 'Presse 2', 'Tour CN', 'Fraiseuse', 'Emballage']) {
    let t = start;
    let running = r() > 0.25;
    while (t < end) {
      const u = r();
      const etat = running ? 'Production' : u < 0.5 ? 'Réglage' : u < 0.82 ? 'Arrêt' : 'Maintenance';
      const minutes = running ? 70 + Math.round(r() * 22) * 10 : etat === 'Maintenance' ? 60 + Math.round(r() * 6) * 10 : 20 + Math.round(r() * 5) * 10;
      const fin = Math.min(end, t + minutes * 60000);
      out.push({ machine, etat, debut: t, fin });
      t = fin;
      running = !running;
    }
  }
  return out;
})();

const time = { type: 'time' } as const;

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Temps et planning',
    entries: [
      {
        title: 'Gantt avec avancement et dépendances',
        caption: 'gantt · progress remplit la barre, depends trace les flèches, style.today pose la ligne du jour',
        wide: true,
        spec: {
          title: 'Refonte du site marchand',
          subtitle: 'Avancement au 25 mars 2026',
          data: redesign,
          fields: {
            debut: { ...time, label: 'Début' },
            fin: { ...time, label: 'Fin' },
            avancement: { label: 'Avancement' },
            responsable: { label: 'Responsable' },
          },
          layers: [
            {
              mark: 'gantt',
              encode: { key: 'tache', x: 'debut', x2: 'fin', progress: 'avancement', depends: 'apres', color: 'responsable' },
              style: { today: '2026-03-25' },
            },
          ],
          // In a phone's card the rows need the legend's height to keep their names.
          responsive: [{ maxHeight: 340, spec: { subtitle: 'Au 25 mars 2026, couleur par responsable', legend: false } }],
        },
      },
      {
        title: 'Gantt par phases et jalons',
        caption: 'gantt · group ouvre chaque phase par une barre de synthèse, début = fin dessine un jalon ; replié en petit (collapsed)',
        wide: true,
        spec: {
          title: 'Ouverture du magasin de Nantes',
          subtitle: 'Trois phases, chacune close par un jalon',
          data: shop,
          fields: { debut: { ...time, label: 'Début' }, fin: { ...time, label: 'Fin' }, etat: { label: 'État' }, phase: { label: 'Phase' } },
          // `domain` gives the legend its entries (and their order) when the colors are explicit.
          scales: { color: { domain: ['Terminé', 'En cours', 'À venir'], colors: { Terminé: '#1baf7a', 'En cours': '#2a78d6', 'À venir': '#9a988f' } } },
          layers: [
            {
              mark: 'gantt',
              encode: { key: 'tache', id: 'id', x: 'debut', x2: 'fin', progress: 'avancement', group: 'phase', depends: 'apres', color: 'etat' },
              style: { today: '2026-03-25' },
            },
          ],
          // Sixteen rows do not fit a phone's card: the phases alone do.
          responsive: [{ maxHeight: 340, spec: { subtitle: 'Avancement par phase', legend: false, layers: [{ mark: 'gantt', encode: {}, style: { collapsed: true } }] } }],
        },
      },
      {
        title: 'Planning des salles',
        caption: 'schedule · une ligne par salle, les réservations qui se chevauchent passent sur des sous-lignes',
        wide: true,
        spec: {
          title: 'Salles de réunion',
          subtitle: 'Mercredi 18 mars 2026',
          data: rooms,
          fields: { debut: { ...time, label: 'Début' }, fin: { ...time, label: 'Fin' }, salle: { label: 'Salle' }, type: { label: 'Type' } },
          layers: [
            {
              mark: 'schedule',
              encode: { y: 'salle', x: 'debut', x2: 'fin', key: 'titre', color: 'type' },
              style: { today: '2026-03-18T13:00:00' },
            },
          ],
        },
      },
      {
        title: 'Planning d’affectation',
        caption: 'schedule · une ligne par personne sur six semaines ; deux missions en même temps = deux sous-lignes',
        spec: {
          title: 'Affectations de l’équipe',
          subtitle: 'Mai et juin 2026, par client',
          data: staffing,
          fields: { debut: { ...time, label: 'Début' }, fin: { ...time, label: 'Fin' }, personne: { label: 'Personne' }, client: { label: 'Client' } },
          layers: [{ mark: 'schedule', encode: { y: 'personne', x: 'debut', x2: 'fin', key: 'mission', color: 'client' } }],
        },
      },
      {
        title: 'États des machines',
        caption: 'swimlane · l’état de chaque machine par plages colorées (state timeline)',
        wide: true,
        spec: {
          title: 'Atelier : états des machines',
          subtitle: 'Mercredi 18 mars 2026, de 6 h à 22 h',
          data: machines,
          fields: { debut: { ...time, label: 'Début' }, fin: { ...time, label: 'Fin' }, machine: { label: 'Machine' }, etat: { label: 'État' } },
          scales: { color: { domain: ['Production', 'Réglage', 'Arrêt', 'Maintenance'], colors: { Production: '#1baf7a', Réglage: '#e8a23a', Arrêt: '#e34948', Maintenance: '#2a78d6' } } },
          layers: [{ mark: 'swimlane', encode: { y: 'machine', x: 'debut', x2: 'fin', color: 'etat' } }],
        },
      },
    ],
  },
];
