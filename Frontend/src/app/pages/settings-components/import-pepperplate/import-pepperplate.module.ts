import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';

import { ImportPepperplatePage } from './import-pepperplate.page';

@NgModule({
  declarations: [
    ImportPepperplatePage,
  ],
  imports: [
    CommonModule,
    IonicModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule.forChild([
      {
        path: '',
        component: ImportPepperplatePage
      }
    ])
  ],
})
export class ImportPepperplatePageModule {}
