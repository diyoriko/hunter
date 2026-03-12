/**
 * User profile — the "brain" of scoring.
 * Skills, preferences, weights — all in one place.
 */

export interface SkillWeight {
  name: string;
  weight: number; // 0.0 - 1.0
  /** Aliases for matching against vacancy text */
  aliases: string[];
}

export interface UserProfile {
  name: string;
  title: string;
  yearsExperience: number;
  salaryMin: number;  // RUB/month
  salaryMax: number;
  preferredFormat: 'remote' | 'hybrid' | 'any';
  skills: SkillWeight[];
  /** Preferred domains (bonus points) */
  domains: { name: string; weight: number; aliases: string[] }[];
  /** Negative signals — vacancy gets penalized */
  redFlags: string[];
  /** Search queries for hh.ru */
  searchQueries: string[];
}

export const PROFILE: UserProfile = {
  name: 'Диёр Хакимов',
  title: 'Product & Brand Designer',
  yearsExperience: 10,
  salaryMin: 300_000,
  salaryMax: 500_000,
  preferredFormat: 'remote',

  skills: [
    {
      name: 'Product Design',
      weight: 1.0,
      aliases: ['продуктовый дизайн', 'product design', 'продуктовый дизайнер', 'product designer'],
    },
    {
      name: 'Figma',
      weight: 1.0,
      aliases: ['figma', 'фигма'],
    },
    {
      name: 'Branding',
      weight: 1.0,
      aliases: ['брендинг', 'branding', 'бренд', 'brand', 'brand identity', 'айдентика', 'identity', 'фирменный стиль'],
    },
    {
      name: 'UI/UX',
      weight: 0.9,
      aliases: ['ui/ux', 'ui ux', 'ux/ui', 'ux ui', 'user experience', 'user interface', 'юзабилити'],
    },
    {
      name: 'Landing Pages',
      weight: 0.8,
      aliases: ['лендинг', 'landing', 'landing page', 'посадочная страница', 'промо-страниц'],
    },
    {
      name: 'HTML/CSS',
      weight: 0.8,
      aliases: ['html', 'css', 'вёрстка', 'верстка', 'html/css', 'html5', 'css3'],
    },
    {
      name: 'Typography',
      weight: 0.7,
      aliases: ['типографика', 'typography', 'шрифт'],
    },
    {
      name: 'Design Systems',
      weight: 0.7,
      aliases: ['дизайн-система', 'design system', 'ui kit', 'компонент'],
    },
    {
      name: 'TypeScript',
      weight: 0.6,
      aliases: ['typescript', 'ts', 'javascript', 'js'],
    },
    {
      name: 'Motion Design',
      weight: 0.5,
      aliases: ['моушн', 'motion', 'анимация', 'animation', 'after effects'],
    },
    {
      name: 'Packaging',
      weight: 0.5,
      aliases: ['упаковка', 'packaging', 'печатная продукция', 'print'],
    },
  ],

  domains: [
    { name: 'SaaS/B2B', weight: 0.8, aliases: ['saas', 'b2b', 'платформа', 'platform', 'enterprise'] },
    { name: 'EdTech', weight: 0.7, aliases: ['edtech', 'образование', 'education', 'обучение', 'курс'] },
    { name: 'FinTech', weight: 0.6, aliases: ['fintech', 'финтех', 'banking', 'банк', 'платёж', 'payment'] },
    { name: 'E-commerce', weight: 0.5, aliases: ['ecommerce', 'e-commerce', 'ecom', 'магазин', 'shop', 'marketplace'] },
    { name: 'HealthTech', weight: 0.5, aliases: ['healthtech', 'здоров', 'health', 'медицин', 'med'] },
    { name: 'AI/ML', weight: 0.6, aliases: ['ai', 'ml', 'искусственный интеллект', 'нейросет', 'machine learning'] },
  ],

  redFlags: [
    'junior',
    'стажёр',
    'intern',
    'бесплатно',
    'без оплаты',
    'game design',
    'геймдизайн',
    '3d',
    'unity',
    'unreal',
    'промышленный дизайн',
    'industrial design',
    'архитектор', // architectural
    'интерьер',   // interior design
  ],

  searchQueries: [
    'продуктовый дизайнер',
    'product designer',
    'UX/UI дизайнер senior',
    'бренд дизайнер',
    'дизайнер интерфейсов',
    'UI дизайнер senior',
    'веб-дизайнер',
    'дизайнер лендингов',
    'lead designer',
  ],
};
