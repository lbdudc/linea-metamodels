grammar FeatureModel
import './common'

// Feature model: the features of an SPL as a tree of groups (mandatory, optional, alternative, or), and the constraints between features.
// @level 1
//
// The SPL declares it once; the products pick from it with a `featureselection`.
//
//   featuremodel Phones
//   feature Phones {
//     mandatory { feature Screen { alternative { feature Lcd  feature Oled } } }
//     optional  { feature Camera  feature Gps }
//   }
//   constraints { Gps => Oled }
entry FeatureTree: 'featuremodel' name=Name root=Feature ('constraints' '{' (constraints+=Constraint)* '}')?;

Feature: (abstract?='abstract')? 'feature' name=Name ('{' (groups+=Group)* '}')?;

// mandatory: every feature is in the product whenever its parent is; optional: any of them may be;
// alternative: exactly one of them (xor); or: at least one of them; [m..n]: between m and n of them ([m..*]: m or more, [m]: exactly m)
Group: (kind=('mandatory' | 'optional' | 'alternative' | 'or') | '[' min=INT ('..' (max=INT | unbounded?='*'))? ']') '{' (features+=Feature)* '}';

// Boolean formulas over features, with UVL's operators. A formula is written as a chain, and the operators bind from the tightest to the
// loosest as & | => <=>, all of them grouping to the left as in UVL (A => B => C is (A => B) => C); parentheses group.
Constraint: first=Operand (links+=Link)*;
Link: operator=('<=>' | '=>' | '|' | '&') operand=Operand;
Operand: (negated?='!')? (feature=[Feature:Name] | '(' inner=Constraint ')');
