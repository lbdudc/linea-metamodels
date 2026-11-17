grammar FeatureSelection
import './common'
import './featuremodel'

// Feature selection: the features a product selects from the feature model of its SPL.
//
//   selection of Phones {
//     select Oled
//     select Gps
//     deselect Camera
//   }
//
// Whatever the model makes mandatory, or the chosen features need, is implied: it does not have to be written.
entry Selection: 'selection' 'of' model=[FeatureTree:Name] '{' (choices+=Choice)* '}';

Choice: (selected?='select' | 'deselect') feature=[Feature:Name];
