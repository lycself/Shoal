module e2e_model_library

   use fabm_types, only: type_base_model_factory, type_base_model
   use e2e_models

   implicit none

   private

   type, extends(type_base_model_factory) :: type_factory
   contains
      procedure :: create
   end type

   type (type_factory), save, target, public :: e2e_model_factory

contains

   subroutine create(self, name, model)
      class (type_factory), intent(in) :: self
      character(*),         intent(in) :: name
      class (type_base_model), pointer :: model

      select case (name)
         case ('fish');         allocate(type_e2e_fish::model)
         case ('macrobenthos'); allocate(type_e2e_macrobenthos::model)
      end select
   end subroutine create

end module e2e_model_library
