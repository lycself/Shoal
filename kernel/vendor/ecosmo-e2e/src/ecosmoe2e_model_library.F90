module ecosmoe2e_model_library

   use fabm_types, only: type_base_model_factory, type_base_model
   use fabm_ecosmoe2e_mb
   use fabm_ecosmoe2e_fish
   ! Add use statements for new models here

   implicit none

   private

   type, extends(type_base_model_factory) :: type_factory
   contains
      procedure :: create
   end type

   type (type_factory), save, target, public :: ecosmoe2e_model_factory

contains

   subroutine create(self, name, model)

      class (type_factory), intent(in) :: self
      character(*),         intent(in) :: name
      class (type_base_model), pointer :: model

      select case (name)
         ! Add case statements for new models here
         case ('mb'); allocate(type_ecosmoe2e_mb::model)
         case ('fish'); allocate(type_ecosmoe2e_fish::model)
      end select

   end subroutine create

end module
