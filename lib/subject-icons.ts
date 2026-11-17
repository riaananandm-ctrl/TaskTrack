import {
  BookOpen, Calculator, FlaskConical, Globe, Languages, PenTool, Palette, Music, Code,
  Dumbbell, Brain, Heart, Camera, Microscope, Ruler, Library, type LucideIcon,
} from 'lucide-react';

/**
 * The icons a subject can use (see SUBJECT_ICONS). Importing only these keeps the
 * Subjects page small; importing the whole icon library added about 170 kB.
 */
const ICONS: Record<string, LucideIcon> = {
  BookOpen, Calculator, FlaskConical, Globe, Languages, PenTool, Palette, Music, Code,
  Dumbbell, Brain, Heart, Camera, Microscope, Ruler, Library,
};

export function SubjectIcon(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name]) || BookOpen;
}
